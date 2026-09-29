import { Bot, Context, InlineKeyboard } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import { conversations, createConversation, type Conversation, type ConversationFlavor } from "@grammyjs/conversations";
import { exec } from "node:child_process";
import {
  CHECK_INTERVAL_HOURS,
  CITY_NAMES,
  RUN_WINDOW_MINUTES,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  WINDOWS,
  resolveCity,
} from "./config.js";
import { send } from "./alerts.js";
import {
  ADD_USAGE,
  ALL_PAUSED,
  CANCELLED,
  CHECKING,
  EDIT_PICK,
  EDIT_SITE,
  HELP,
  LOADING_POINTS,
  NO_ROUTES,
  ONLINE,
  PAUSE_PICK,
  PICK_FROM,
  PICK_SITE,
  SAME_CITY,
  SITE_LABELS,
  TARGET_INVALID,
  TARGET_PROMPT,
  addedTexts,
  badDateText,
  editMenuText,
  errorText,
  fmtRs,
  listText,
  notFoundText,
  pauseDoneText,
  pickDate,
  pickDropoff,
  pickPickup,
  pickTime,
  pickTo,
  removeDoneText,
  removePickText,
  removedText,
  summaryText,
  targetClearedText,
  targetSetText,
  unknownCityText,
  updatedText,
} from "./messages.js";
import { addRoute, loadRoutes, removeRoute, updateRoute } from "./store.js";
import { runCheck } from "./monitor.js";
import { collectPoints } from "./points.js";
import type { Site, SiteChoice } from "./types.js";

type BotContext = ConversationFlavor<Context>;

const HTML = { parse_mode: "HTML" as const };

let syncTimer: NodeJS.Timeout | undefined;
let syncChain: Promise<void> = Promise.resolve();

const syncRoutes = (): void => {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncChain = syncChain.then(
      () =>
        new Promise<void>((resolve) => {
          exec(
            "git pull --rebase --autostash && git add routes.json " +
              '&& git commit -m "Update watched routes" && git push',
            (err, _out, stderr) => {
              if (err) console.error("routes sync failed:", stderr || err.message);
              resolve();
            },
          );
        }),
    );
  }, 3000);
};

let removeSelection = new Set<number>();

const removeKeyboard = () => {
  const rows: InlineKeyboardButton[][] = loadRoutes().map((r) => [
    {
      text: `${removeSelection.has(r.id) ? "✓ " : ""}#${r.id} ${r.source} → ${r.destination} · ${SITE_LABELS[r.site ?? "redbus"]}`,
      callback_data: `sel:${r.id}`,
    },
  ]);
  rows.push([{ text: `Remove selected (${removeSelection.size})`, callback_data: "selgo" }]);
  rows.push([{ text: "Done", callback_data: "selcancel" }]);
  return new InlineKeyboard(rows);
};

const pauseKeyboard = () => {
  const rows: InlineKeyboardButton[][] = loadRoutes().map((r) => [
    {
      text: `#${r.id} ${r.source} → ${r.destination} — ${r.paused ? "paused" : "active"}`,
      callback_data: `ptoggle:${r.id}`,
    },
  ]);
  rows.push([{ text: "Done", callback_data: "pclose" }]);
  return new InlineKeyboard(rows);
};

const editPickKeyboard = () => {
  const rows: InlineKeyboardButton[][] = loadRoutes().map((r) => [
    {
      text: `#${r.id} ${r.source} → ${r.destination}${r.paused ? " · paused" : ""}`,
      callback_data: `editpick:${r.id}`,
    },
  ]);
  rows.push([{ text: "Close", callback_data: "editclose" }]);
  return new InlineKeyboard(rows);
};

const bot = new Bot<BotContext>(TELEGRAM_BOT_TOKEN);

bot.use(conversations());

const siteKeyboard = () =>
  new InlineKeyboard()
    .text("RedBus", "site:redbus")
    .text("ClearTrip", "site:cleartrip")
    .row()
    .text("Both", "site:both")
    .text("Cancel", "cancel");

const cityKeyboard = (side: "F" | "T", exclude?: string) =>
  new InlineKeyboard(
    CITY_NAMES.filter((n) => n !== exclude).map(
      (n): InlineKeyboardButton[] => [{ text: n, callback_data: `city:${side}:${n}` }],
    ),
  ).text("Cancel", "cancel");

const monthKeyboard = (year: number, month: number, today: string) => {
  const rows: InlineKeyboardButton[][] = [
    [
      { text: "<", callback_data: "cal:M:-1" },
      {
        text: new Date(year, month - 1, 1).toLocaleString("en", { month: "long", year: "numeric" }),
        callback_data: "noop",
      },
      { text: ">", callback_data: "cal:M:+1" },
    ],
    ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => ({ text: d, callback_data: "noop" })),
  ];
  const startOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  let day = 1 - startOffset;
  while (day <= daysInMonth) {
    const row: InlineKeyboardButton[] = [];
    for (let i = 0; i < 7; i++, day++) {
      if (day < 1 || day > daysInMonth) {
        row.push({ text: " ", callback_data: "noop" });
      } else {
        const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        row.push(
          iso < today
            ? { text: "·", callback_data: "noop" }
            : { text: String(day), callback_data: `cal:D:${iso}` },
        );
      }
    }
    rows.push(row);
  }
  rows.push([{ text: "Cancel", callback_data: "cancel" }]);
  return new InlineKeyboard(rows);
};

const timeKeyboard = (selected: Set<string>) => {
  const rows: InlineKeyboardButton[][] = WINDOWS.map(([key, label]) => [
    { text: `${selected.has(key) ? "✓ " : ""}${label}`, callback_data: `time:toggle:${key}` },
  ]);
  rows.push([
    {
      text: selected.size > 0 ? `Done (${selected.size})` : "Done (all day)",
      callback_data: "time:done",
    },
  ]);
  rows.push([{ text: "Cancel", callback_data: "cancel" }]);
  return new InlineKeyboard(rows);
};

const pointKeyboard = (selected: Set<number>, options: string[], kind: "p" | "d") =>
  new InlineKeyboard(
    options.map(
      (name, i): InlineKeyboardButton[] => [
        { text: `${selected.has(i) ? "✓ " : ""}${name}`, callback_data: `pts:${kind}:${i}` },
      ],
    ),
  )
    .row({
      text: selected.size > 0 ? `Done (${selected.size})` : "Done (any point)",
      callback_data: `pts:${kind}:done`,
    })
    .row({ text: "Cancel", callback_data: "cancel" });

const nextMonth = (y: number, m: number, delta: number): [number, number] => {
  const nm = m + delta;
  if (nm < 1) return [y - 1, 12];
  if (nm > 12) return [y + 1, 1];
  return [y, nm];
};

async function waitForCallback(
  conv: Conversation<BotContext>,
): Promise<{ data: string; messageId: number; chatId: number }> {
  const cb = await conv.waitFor("callback_query");
  await cb.answerCallbackQuery();
  return {
    data: cb.callbackQuery.data ?? "",
    messageId: cb.callbackQuery.message!.message_id,
    chatId: cb.callbackQuery.message!.chat.id,
  };
}

type Anchor = { chatId: number; messageId: number };

async function edit(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard) {
  await bot.api
    .editMessageText(
      chatId,
      messageId,
      text,
      keyboard
        ? { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard.inline_keyboard } }
        : { parse_mode: "HTML" },
    )
    .catch(() => undefined);
}

interface PointPick {
  points: string[] | null;
  anchor: Anchor;
}

async function pickPointSet(
  conv: Conversation<BotContext>,
  anchor: Anchor,
  title: string,
  options: string[],
  kind: "p" | "d",
  silentCancel = false,
): Promise<PointPick> {
  if (options.length === 0) return { points: [], anchor };
  const sel = new Set<number>();
  await edit(anchor.chatId, anchor.messageId, title, pointKeyboard(sel, options, kind));
  let last = anchor;
  for (;;) {
    const cb = await waitForCallback(conv);
    if (cb.data === "cancel") {
      if (!silentCancel) await edit(cb.chatId, cb.messageId, CANCELLED);
      return { points: null, anchor: cb };
    }
    last = { chatId: cb.chatId, messageId: cb.messageId };
    if (cb.data === `pts:${kind}:done`) {
      return { points: [...sel].sort((a, b) => a - b).map((i) => options[i]), anchor: last };
    }
    const idx = Number(cb.data.split(":")[2]);
    if (Number.isInteger(idx) && idx >= 0 && idx < options.length) {
      if (sel.has(idx)) sel.delete(idx);
      else sel.add(idx);
    }
    await edit(last.chatId, last.messageId, title, pointKeyboard(sel, options, kind));
  }
}

async function addRouteFlow(conv: Conversation<BotContext>, ctx: Context): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  await ctx.reply(PICK_SITE, { ...HTML, reply_markup: siteKeyboard() });
  let pick = await waitForCallback(conv);
  if (pick.data === "cancel") {
    await edit(pick.chatId, pick.messageId, CANCELLED);
    return;
  }
  const site = pick.data.split(":")[1] as SiteChoice;

  await edit(pick.chatId, pick.messageId, PICK_FROM, cityKeyboard("F"));
  pick = await waitForCallback(conv);
  if (pick.data === "cancel") {
    await edit(pick.chatId, pick.messageId, CANCELLED);
    return;
  }
  const from = pick.data.split(":")[2];

  await edit(pick.chatId, pick.messageId, pickTo(from), cityKeyboard("T", from));
  pick = await waitForCallback(conv);
  if (pick.data === "cancel") {
    await edit(pick.chatId, pick.messageId, CANCELLED);
    return;
  }
  const to = pick.data.split(":")[2];

  let [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  await edit(pick.chatId, pick.messageId, pickDate(from, to, site), monthKeyboard(year, month, today));
  let date = "";
  while (!date) {
    const cb = await waitForCallback(conv);
    if (cb.data === "cancel") {
      await edit(cb.chatId, cb.messageId, CANCELLED);
      return;
    }
    if (cb.data.startsWith("cal:M:")) {
      [year, month] = nextMonth(year, month, Number(cb.data.split(":")[2]));
      await edit(cb.chatId, cb.messageId, pickDate(from, to, site), monthKeyboard(year, month, today));
    } else if (cb.data.startsWith("cal:D:")) {
      date = cb.data.split(":")[2];
      pick = cb;
    }
  }

  const windows = new Set<string>();
  await edit(pick.chatId, pick.messageId, pickTime(from, to, date, site), timeKeyboard(windows));
  let done = false;
  while (!done) {
    const cb = await waitForCallback(conv);
    if (cb.data === "cancel") {
      await edit(cb.chatId, cb.messageId, CANCELLED);
      return;
    }
    if (cb.data.startsWith("time:toggle:")) {
      const key = cb.data.split(":")[2];
      if (windows.has(key)) windows.delete(key);
      else windows.add(key);
      await edit(cb.chatId, cb.messageId, pickTime(from, to, date, site), timeKeyboard(windows));
    } else if (cb.data === "time:done") {
      done = true;
      pick = cb;
    }
  }

    const sites: Site[] = site === "both" ? ["redbus", "cleartrip"] : [site];
    await edit(pick.chatId, pick.messageId, LOADING_POINTS);
    const pts = await collectPoints(site, from, to, date);

    const puRes = await pickPointSet(conv, pick, pickPickup(from, to), pts.pickups, "p");
    if (puRes.points === null) return;
    const dpRes = await pickPointSet(conv, puRes.anchor, pickDropoff(from, to), pts.dropoffs, "d");
    if (dpRes.points === null) return;
    pick = { data: "pts:d:done", ...dpRes.anchor };
    const pickups = puRes.points;
    const dropoffs = dpRes.points;

    await edit(pick.chatId, pick.messageId, TARGET_PROMPT);
    let target: number | undefined;
    for (;;) {
      const msg = await conv.waitFor("message:text");
      const raw = msg.message.text.trim();
      if (/^\/?cancel$/i.test(raw)) {
        await edit(pick.chatId, pick.messageId, CANCELLED);
        return;
      }
      if (/^\/?(skip|no|none|clear)$/i.test(raw)) break;
      const n = Number(raw.replace(/[^\d.]/g, ""));
      if (/\d/.test(raw) && Number.isFinite(n) && n > 0) {
        target = Math.round(n);
        break;
      }
      await edit(pick.chatId, pick.messageId, TARGET_INVALID);
    }

    const routes = sites.map((s) => addRoute(from, to, date, [...windows], s, pickups, dropoffs, target));
    syncRoutes();
    await edit(
      pick.chatId,
      pick.messageId,
      addedTexts(routes),
      new InlineKeyboard().text("View routes", "show:list"),
    );
}

bot.use(createConversation(addRouteFlow, "addRoute"));

async function editRouteFlow(conv: Conversation<BotContext>, ctx: Context, id: number): Promise<void> {
  const get = () => loadRoutes().find((r) => r.id === id);

  const menuKb = () => {
    const r = get();
    return new InlineKeyboard()
      .text("Site", "e:site")
      .text("Date", "e:date")
      .row()
      .text("Time window", "e:time")
      .text("Pickup / Drop", "e:pts")
      .row()
      .text(r?.target !== undefined ? `Target (${fmtRs(r.target)})` : "Target", "e:target")
      .row()
      .text("Done", "e:done");
  };

  const showMenu = async (a: Anchor): Promise<boolean> => {
    const r = get();
    if (!r) {
      await edit(a.chatId, a.messageId, notFoundText(id));
      return false;
    }
    await edit(a.chatId, a.messageId, editMenuText(r), menuKb());
    return true;
  };

  if (!get()) {
    await ctx.reply(notFoundText(id), HTML);
    return;
  }
  const first = await ctx.reply(editMenuText(get()!), { ...HTML, reply_markup: menuKb() });
  let anchor: Anchor = { chatId: first.chat.id, messageId: first.message_id };

  for (;;) {
    const cb = await waitForCallback(conv);
    anchor = { chatId: cb.chatId, messageId: cb.messageId };
    const route = get();
    if (!route) {
      await edit(anchor.chatId, anchor.messageId, notFoundText(id));
      return;
    }

    if (cb.data === "e:done") {
      await edit(anchor.chatId, anchor.messageId, updatedText(route));
      return;
    }

    if (cb.data === "e:site") {
      await edit(
        anchor.chatId,
        anchor.messageId,
        EDIT_SITE,
        new InlineKeyboard()
          .text("RedBus", "e:site:redbus")
          .text("ClearTrip", "e:site:cleartrip")
          .row()
          .text("Cancel", "cancel"),
      );
      const c2 = await waitForCallback(conv);
      anchor = { chatId: c2.chatId, messageId: c2.messageId };
      if (c2.data === "e:site:redbus" || c2.data === "e:site:cleartrip") {
        updateRoute(id, { site: c2.data.split(":")[2] as Site });
        syncRoutes();
      }
      if (!(await showMenu(anchor))) return;
      continue;
    }

    if (cb.data === "e:date") {
      const today = new Date().toISOString().slice(0, 10);
      let [year, month] = [Number(route.date.slice(0, 4)), Number(route.date.slice(5, 7))];
      await edit(anchor.chatId, anchor.messageId, pickDate(route.source, route.destination, route.site), monthKeyboard(year, month, today));
      let newDate = "";
      while (!newDate) {
        const c2 = await waitForCallback(conv);
        anchor = { chatId: c2.chatId, messageId: c2.messageId };
        if (c2.data === "cancel") break;
        if (c2.data.startsWith("cal:M:")) {
          [year, month] = nextMonth(year, month, Number(c2.data.split(":")[2]));
          await edit(anchor.chatId, anchor.messageId, pickDate(route.source, route.destination, route.site), monthKeyboard(year, month, today));
        } else if (c2.data.startsWith("cal:D:")) {
          newDate = c2.data.split(":")[2];
        }
      }
      if (newDate) {
        updateRoute(id, { date: newDate });
        syncRoutes();
      }
      if (!(await showMenu(anchor))) return;
      continue;
    }

    if (cb.data === "e:time") {
      const windows = new Set(route.windows);
      await edit(anchor.chatId, anchor.messageId, pickTime(route.source, route.destination, route.date, route.site), timeKeyboard(windows));
      let done = false;
      while (!done) {
        const c2 = await waitForCallback(conv);
        anchor = { chatId: c2.chatId, messageId: c2.messageId };
        if (c2.data === "cancel") break;
        if (c2.data.startsWith("time:toggle:")) {
          const key = c2.data.split(":")[2];
          if (windows.has(key)) windows.delete(key);
          else windows.add(key);
          await edit(anchor.chatId, anchor.messageId, pickTime(route.source, route.destination, route.date, route.site), timeKeyboard(windows));
        } else if (c2.data === "time:done") {
          done = true;
        }
      }
      if (done) {
        updateRoute(id, { windows: [...windows].sort() });
        syncRoutes();
      }
      if (!(await showMenu(anchor))) return;
      continue;
    }

    if (cb.data === "e:pts") {
      await edit(anchor.chatId, anchor.messageId, LOADING_POINTS);
      const pts = await collectPoints(route.site ?? "redbus", route.source, route.destination, route.date);
      const puRes = await pickPointSet(
        conv,
        anchor,
        pickPickup(route.source, route.destination),
        pts.pickups,
        "p",
        true,
      );
      if (puRes.points !== null) {
        anchor = puRes.anchor;
        const dpRes = await pickPointSet(
          conv,
          anchor,
          pickDropoff(route.source, route.destination),
          pts.dropoffs,
          "d",
          true,
        );
        if (dpRes.points !== null) {
          anchor = dpRes.anchor;
          updateRoute(id, { pickups: puRes.points, dropoffs: dpRes.points });
          syncRoutes();
        }
      }
      if (!(await showMenu(anchor))) return;
      continue;
    }

    if (cb.data === "e:target") {
      await edit(anchor.chatId, anchor.messageId, TARGET_PROMPT);
      for (;;) {
        const msg = await conv.waitFor("message:text");
        const raw = msg.message.text.trim();
        if (/^\/?clear$/i.test(raw)) {
          updateRoute(id, { target: undefined });
          syncRoutes();
          await ctx.reply(targetClearedText(id), HTML);
          break;
        }
        const n = Number(raw.replace(/[^\d.]/g, ""));
        if (/\d/.test(raw) && Number.isFinite(n) && n > 0) {
          updateRoute(id, { target: Math.round(n) });
          syncRoutes();
          await ctx.reply(targetSetText(id, Math.round(n)), HTML);
          break;
        }
        await ctx.reply(TARGET_INVALID, HTML);
      }
      if (!(await showMenu(anchor))) return;
      continue;
    }

    if (!(await showMenu(anchor))) return;
  }
}

bot.use(createConversation(editRouteFlow, "editRoute"));

bot.use(async (ctx, next) => {
  const id = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
  if (id !== undefined && String(id) === TELEGRAM_CHAT_ID) return next();
});

bot.command(["start", "help"], (ctx) => ctx.reply(HELP, HTML));

bot.command("add", async (ctx) => {
  const args = ctx.match.trim();
  if (args) {
    const parts = args.split(/\s+/);
    const siteAliases: Record<string, SiteChoice> = {
      ct: "cleartrip",
      cleartrip: "cleartrip",
      rb: "redbus",
      redbus: "redbus",
      both: "both",
      all: "both",
    };
    let site: SiteChoice = "redbus";
    if (parts.length === 4 && siteAliases[parts[0].toLowerCase()]) {
      site = siteAliases[parts[0].toLowerCase()];
      parts.shift();
    }
    if (parts.length !== 3) {
      await ctx.reply(ADD_USAGE, HTML);
      return;
    }
    const [srcRaw, dstRaw, date] = parts;
    const src = resolveCity(srcRaw);
    const dst = resolveCity(dstRaw);
    if (!src || !dst) {
      await ctx.reply(unknownCityText(!src ? srcRaw : dstRaw), HTML);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < new Date().toISOString().slice(0, 10)) {
      await ctx.reply(badDateText, HTML);
      return;
    }
    if (src.name === dst.name) {
      await ctx.reply(SAME_CITY, HTML);
      return;
    }
    const sites: Site[] = site === "both" ? ["redbus", "cleartrip"] : [site];
    const routes = sites.map((s) => addRoute(src.name, dst.name, date, [], s));
    syncRoutes();
    await ctx.reply(addedTexts(routes), HTML);
    return;
  }
  await ctx.conversation.enter("addRoute");
});

bot.command("list", (ctx) => ctx.reply(listText(loadRoutes()), HTML));

bot.command("pause", async (ctx) => {
  if (loadRoutes().length === 0) return ctx.reply(NO_ROUTES, HTML);
  await ctx.reply(PAUSE_PICK, { ...HTML, reply_markup: pauseKeyboard() });
});

bot.callbackQuery(/^ptoggle:\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = Number(ctx.match[0].split(":")[1]);
  const r = loadRoutes().find((x) => x.id === id);
  if (r) {
    updateRoute(id, { paused: !r.paused });
    syncRoutes();
  }
  await ctx.editMessageText(PAUSE_PICK, { ...HTML, reply_markup: pauseKeyboard() }).catch(() => undefined);
});

bot.callbackQuery("pclose", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(pauseDoneText, HTML).catch(() => undefined);
});

bot.command("edit", async (ctx) => {
  const arg = ctx.match.trim().replace(/^#/, "");
  if (/^\d+$/.test(arg)) {
    const id = Number(arg);
    if (!loadRoutes().some((r) => r.id === id)) return ctx.reply(notFoundText(id), HTML);
    await ctx.conversation.enter("editRoute", id);
    return;
  }
  if (loadRoutes().length === 0) return ctx.reply(NO_ROUTES, HTML);
  await ctx.reply(EDIT_PICK, { ...HTML, reply_markup: editPickKeyboard() });
});

bot.callbackQuery(/^editpick:\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("editRoute", Number(ctx.match[0].split(":")[1]));
});

bot.callbackQuery("editclose", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(removeDoneText, HTML).catch(() => undefined);
});

bot.command("remove", async (ctx) => {
  const arg = ctx.match.trim().replace(/^#/, "");
  if (/^\d+$/.test(arg)) {
    const id = Number(arg);
    const removed = removeRoute(id);
    if (removed) syncRoutes();
    return ctx.reply(removed ? removedText(id) : notFoundText(id), HTML);
  }
  if (loadRoutes().length === 0) return ctx.reply(NO_ROUTES, HTML);
  removeSelection = new Set();
  await ctx.reply(removePickText(), { ...HTML, reply_markup: removeKeyboard() });
});

bot.callbackQuery(/^sel:\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = Number(ctx.match[0].split(":")[1]);
  if (removeSelection.has(id)) removeSelection.delete(id);
  else removeSelection.add(id);
  await ctx
    .editMessageText(removePickText(), { ...HTML, reply_markup: removeKeyboard() })
    .catch(() => undefined);
});

bot.callbackQuery("selgo", async (ctx) => {
  const ids = [...removeSelection].sort((a, b) => a - b);
  if (ids.length === 0) {
    await ctx.answerCallbackQuery({ text: "Select at least one route" });
    return;
  }
  await ctx.answerCallbackQuery();
  for (const id of ids) removeRoute(id);
  removeSelection.clear();
  syncRoutes();
  const note = `Removed ${ids.map((i) => `<b>#${i}</b>`).join(", ")}.`;
  const routes = loadRoutes();
  if (routes.length === 0) {
    await ctx.editMessageText(`${note}\n\n${removeDoneText}`, HTML).catch(() => undefined);
    return;
  }
  await ctx
    .editMessageText(removePickText(note), { ...HTML, reply_markup: removeKeyboard() })
    .catch(() => undefined);
});

bot.callbackQuery("selcancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  removeSelection.clear();
  await ctx.editMessageText(removeDoneText, HTML).catch(() => undefined);
});

bot.command("check", async (ctx) => {
  await ctx.reply(CHECKING, HTML);
  runCheck(false)
    .then((res) => {
      if (res.status === "empty") {
        return ctx.reply(loadRoutes().length > 0 ? ALL_PAUSED : NO_ROUTES, HTML);
      }
      return ctx.reply(summaryText(res.results, res.errors), HTML);
    })
    .catch((exc) => ctx.reply(errorText(exc), HTML));
});

bot.callbackQuery("show:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(listText(loadRoutes()), HTML);
});

bot.catch((err) => console.error("Bot error:", err.error));

async function main(): Promise<void> {
  await bot.api.setMyCommands([
    { command: "add", description: "Watch a new route (city + date pickers)" },
    { command: "list", description: "Show watched routes" },
    { command: "edit", description: "Edit a route (date, time, points, target)" },
    { command: "pause", description: "Pause or resume routes" },
    { command: "remove", description: "Stop watching a route, e.g. /remove 1" },
    { command: "check", description: "Check prices right now" },
    { command: "help", description: "Show usage" },
  ]);
  if (process.env.ANNOUNCE_ONLINE !== "0") await send(ONLINE);
  runCheck(true).catch((exc) => console.error("initial check failed:", exc));
  setInterval(() => {
    runCheck(true).catch((exc) => send(errorText(exc)).catch(() => undefined));
  }, CHECK_INTERVAL_HOURS * 3600_000);
  bot.start({ drop_pending_updates: false });
  if (RUN_WINDOW_MINUTES > 0) {
    setTimeout(() => {
      console.log(`run window of ${RUN_WINDOW_MINUTES} minutes over; exiting cleanly`);
      bot.stop();
      process.exit(0);
    }, RUN_WINDOW_MINUTES * 60_000);
  }
}

main().catch((exc) => {
  console.error(exc);
  process.exit(1);
});
