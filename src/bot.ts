import { Bot, Context, InlineKeyboard } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import { conversations, createConversation, type Conversation, type ConversationFlavor } from "@grammyjs/conversations";
import { exec } from "node:child_process";
import {
  CHECK_INTERVAL_HOURS,
  CITY_NAMES,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  WINDOWS,
  resolveCity,
} from "./config.js";
import { send } from "./alerts.js";
import {
  ADD_USAGE,
  CANCELLED,
  CHECKING,
  HELP,
  LOADING_POINTS,
  NO_ROUTES,
  ONLINE,
  PICK_FROM,
  PICK_SITE,
  SAME_CITY,
  SITE_LABELS,
  addedTexts,
  badDateText,
  errorText,
  listText,
  notFoundText,
  pickDate,
  pickDropoff,
  pickPickup,
  pickTime,
  pickTo,
  removeDoneText,
  removePickText,
  removedText,
  summaryText,
  unknownCityText,
} from "./messages.js";
import { addRoute, loadRoutes, removeRoute } from "./store.js";
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

    const pickSet = async (
      title: string,
      options: string[],
      kind: "p" | "d",
    ): Promise<string[] | null> => {
      if (options.length === 0) return [];
      const sel = new Set<number>();
      await edit(pick.chatId, pick.messageId, title, pointKeyboard(sel, options, kind));
      for (;;) {
        const cb = await waitForCallback(conv);
        if (cb.data === "cancel") {
          await edit(cb.chatId, cb.messageId, CANCELLED);
          return null;
        }
        pick = cb;
        if (cb.data === `pts:${kind}:done`) {
          return [...sel].sort((a, b) => a - b).map((i) => options[i]);
        }
        const idx = Number(cb.data.split(":")[2]);
        if (Number.isInteger(idx) && idx >= 0 && idx < options.length) {
          if (sel.has(idx)) sel.delete(idx);
          else sel.add(idx);
        }
        await edit(cb.chatId, cb.messageId, title, pointKeyboard(sel, options, kind));
      }
    };

    const pickups = await pickSet(pickPickup(from, to), pts.pickups, "p");
    if (pickups === null) return;
    const dropoffs = await pickSet(pickDropoff(from, to), pts.dropoffs, "d");
    if (dropoffs === null) return;

    const routes = sites.map((s) => addRoute(from, to, date, [...windows], s, pickups, dropoffs));
    syncRoutes();
    await edit(
      pick.chatId,
      pick.messageId,
      addedTexts(routes),
      new InlineKeyboard().text("View routes", "show:list"),
    );
}

bot.use(createConversation(addRouteFlow, "addRoute"));

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
      if (res.status === "empty") return ctx.reply(NO_ROUTES, HTML);
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
}

main().catch((exc) => {
  console.error(exc);
  process.exit(1);
});
