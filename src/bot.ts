import { Bot, Context, InlineKeyboard } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import { conversations, createConversation, type Conversation, type ConversationFlavor } from "@grammyjs/conversations";
import {
  CHECK_INTERVAL_HOURS,
  CITY_NAMES,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  WINDOWS,
  WINDOW_LABELS,
  resolveCity,
} from "./config.js";
import { send } from "./alerts.js";
import { addRoute, loadRoutes, removeRoute } from "./store.js";
import { formatSummary, runCheck } from "./monitor.js";

type BotContext = ConversationFlavor<Context>;

const HELP = [
  "Bus Fare Monitor",
  "",
  "/add - watch a new route (opens pickers)",
  "/list - show watched routes",
  "/remove <id> - stop watching a route",
  "/check - check prices now",
  "/help - this message",
  "",
  "You can also type: /add bangalore salem 2026-10-05",
].join("\n");

const bot = new Bot<BotContext>(TELEGRAM_BOT_TOKEN);

bot.use(conversations());

const cityKeyboard = (side: "F" | "T", exclude?: string) =>
  new InlineKeyboard(
    CITY_NAMES.filter((n) => n !== exclude).map((n): InlineKeyboardButton[] => [{ text: n, callback_data: `city:${side}:${n}` }]),
  ).text("Cancel", "cancel");

const monthKeyboard = (year: number, month: number, today: string) => {
  const rows: InlineKeyboardButton[][] = [
    [
      { text: "<", callback_data: "cal:M:-1" },
      { text: new Date(year, month - 1, 1).toLocaleString("en", { month: "long", year: "numeric" }), callback_data: "noop" },
      { text: ">", callback_data: "cal:M:+1" },
    ],
    ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => ({ text: d, callback_data: "noop" })),
  ];
  const first = new Date(year, month - 1, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  let day = 1 - startOffset;
  while (day <= daysInMonth) {
    const row: InlineKeyboardButton[] = [];
    for (let i = 0; i < 7; i++, day++) {
      if (day < 1 || day > daysInMonth) {
        row.push({ text: " ", callback_data: "noop" });
      } else {
        const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (iso < today) row.push({ text: "·", callback_data: "noop" });
        else row.push({ text: String(day), callback_data: `cal:D:${iso}` });
      }
    }
    rows.push(row);
  }
  rows.push([{ text: "Cancel", callback_data: "cancel" }]);
  return new InlineKeyboard(rows);
};

const timeKeyboard = (selected: Set<string>) => {
  const rows: InlineKeyboardButton[][] = WINDOWS.map(([key, label]) => [
    { text: `${selected.has(key) ? "✅ " : ""}${label}`, callback_data: `time:toggle:${key}` },
  ]);
  rows.push([
    {
      text: selected.size > 0 ? `Done (${selected.size} selected)` : "Done (all day)",
      callback_data: "time:done",
    },
  ]);
  rows.push([{ text: "Cancel", callback_data: "cancel" }]);
  return new InlineKeyboard(rows);
};

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
      keyboard ? { reply_markup: { inline_keyboard: keyboard.inline_keyboard } } : undefined,
    )
    .catch(() => undefined);
}

async function addRouteFlow(conv: Conversation<BotContext>, ctx: Context): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  let msg = await ctx.reply("Where are you travelling from?", { reply_markup: cityKeyboard("F") });
  let pick = await waitForCallback(conv);
  if (pick.data === "cancel") {
    await edit(pick.chatId, pick.messageId, "Cancelled. Send /add to start again.");
    return;
  }
  const from = pick.data.split(":")[2];

  await edit(pick.chatId, pick.messageId, `From: ${from}\nWhere to?`, cityKeyboard("T", from));
  pick = await waitForCallback(conv);
  if (pick.data === "cancel") {
    await edit(pick.chatId, pick.messageId, "Cancelled. Send /add to start again.");
    return;
  }
  const to = pick.data.split(":")[2];

  let [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  await edit(pick.chatId, pick.messageId, `${from} -> ${to}\nPick your travel date:`, monthKeyboard(year, month, today));
  let date = "";
  while (!date) {
    const cb = await waitForCallback(conv);
    if (cb.data === "cancel") {
      await edit(cb.chatId, cb.messageId, "Cancelled. Send /add to start again.");
      return;
    }
    if (cb.data.startsWith("cal:M:")) {
      [year, month] = nextMonth(year, month, Number(cb.data.split(":")[2]));
      await edit(cb.chatId, cb.messageId, `${from} -> ${to}\nPick your travel date:`, monthKeyboard(year, month, today));
    } else if (cb.data.startsWith("cal:D:")) {
      date = cb.data.split(":")[2];
      pick = cb;
    }
  }

  const windows = new Set<string>();
  await edit(
        pick.chatId,
    pick.messageId,
    `${from} -> ${to} on ${date}\nPick departure time (tap to toggle, pick several if you like):`,
    timeKeyboard(windows),
  );
  let done = false;
  while (!done) {
    const cb = await waitForCallback(conv);
    if (cb.data === "cancel") {
      await edit(cb.chatId, cb.messageId, "Cancelled. Send /add to start again.");
      return;
    }
    if (cb.data.startsWith("time:toggle:")) {
      const key = cb.data.split(":")[2];
      windows.has(key) ? windows.delete(key) : windows.add(key);
      await edit(
            cb.chatId,
        cb.messageId,
        `${from} -> ${to} on ${date}\nPick departure time (tap to toggle, pick several if you like):`,
        timeKeyboard(windows),
      );
    } else if (cb.data === "time:done") {
      done = true;
      pick = cb;
    }
  }

  const route = addRoute(from, to, date, [...windows]);
  const winText =
    windows.size > 0
      ? `\nTime: ${[...windows].map((w) => WINDOW_LABELS[w]).join(", ")}`
      : "\nTime: all day";
  await edit(
        pick.chatId,
    pick.messageId,
    `Watching #${route.id}: ${from} -> ${to} on ${date}${winText}`,
    new InlineKeyboard().text("View routes", "show:list"),
  );
}

bot.use(createConversation(addRouteFlow, "addRoute"));

bot.use(async (ctx, next) => {
  const id = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
  if (id !== undefined && String(id) === TELEGRAM_CHAT_ID) return next();
});

bot.command(["start", "help"], (ctx) => ctx.reply(HELP));

bot.command("add", async (ctx) => {
  const args = ctx.match.trim();
  if (args) {
    const parts = args.split(/\s+/);
    if (parts.length !== 3) {
      await ctx.reply("Usage: /add <from> <to> <YYYY-MM-DD> — or just /add to use the pickers.");
      return;
    }
    const [srcRaw, dstRaw, date] = parts;
    const src = resolveCity(srcRaw);
    const dst = resolveCity(dstRaw);
    if (!src || !dst) {
      await ctx.reply(`Unknown city. Known: ${CITY_NAMES.join(", ")}`);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < new Date().toISOString().slice(0, 10)) {
      await ctx.reply("Date must be YYYY-MM-DD and in the future, e.g. 2026-10-05");
      return;
    }
    if (src.name === dst.name) {
      await ctx.reply("Source and destination are the same.");
      return;
    }
    const route = addRoute(src.name, dst.name, date, []);
    await ctx.reply(`Watching #${route.id}: ${src.name} -> ${dst.name} on ${date} (all day)`);
    return;
  }
  await ctx.conversation.enter("addRoute");
});

bot.command("list", (ctx) => {
  const routes = loadRoutes();
  if (routes.length === 0) return ctx.reply("No routes yet. Add one with /add");
  const lines = ["Watched routes:"];
  for (const r of routes) {
    const win = r.windows.length > 0 ? ` | ${r.windows.map((w) => WINDOW_LABELS[w]).join(", ")}` : " | all day";
    lines.push(`#${r.id}: ${r.source} -> ${r.destination} (${r.date})${win}`);
  }
  return ctx.reply(lines.join("\n"));
});

bot.command("remove", (ctx) => {
  const arg = ctx.match.trim().replace(/^#/, "");
  if (!/^\d+$/.test(arg)) return ctx.reply("Usage: /remove <id>");
  return ctx.reply(removeRoute(Number(arg)) ? `Removed #${arg}.` : `No route with id #${arg}.`);
});

bot.command("check", async (ctx) => {
  await ctx.reply("Checking prices…");
  runCheck(false)
    .then((res) => {
      if (res.status === "empty") return ctx.reply("No routes to check. Add one first.");
      return ctx.reply(formatSummary(res.results, res.errors) || "No results.");
    })
    .catch((exc) => ctx.reply(`Check failed: ${exc}`));
});

bot.callbackQuery("show:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const routes = loadRoutes();
  const lines =
    routes.length === 0
      ? ["No routes yet. Add one with /add"]
      : [
          "Watched routes:",
          ...routes.map((r) => {
            const win = r.windows.length > 0 ? ` | ${r.windows.map((w) => WINDOW_LABELS[w]).join(", ")}` : " | all day";
            return `#${r.id}: ${r.source} -> ${r.destination} (${r.date})${win}`;
          }),
        ];
  await ctx.editMessageText(lines.join("\n"));
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
  await send(
    `Bus Fare Monitor online (Node/TS). Interval: ${CHECK_INTERVAL_HOURS}h\nType /add to start watching routes.`,
  );
  setInterval(() => {
    runCheck(true).catch((exc) => send(`Check failed: ${exc}`).catch(() => undefined));
  }, CHECK_INTERVAL_HOURS * 3600_000);
  bot.start({ drop_pending_updates: true });
}

main().catch((exc) => {
  console.error(exc);
  process.exit(1);
});
