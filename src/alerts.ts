import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from "./config.js";
import type { InlineKeyboard } from "grammy";

const API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

export interface SendOptions {
  chatId?: string;
  keyboard?: InlineKeyboard;
}

export async function send(text: string, opts: SendOptions = {}): Promise<void> {
  const resp = await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: opts.chatId ?? TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      ...(opts.keyboard ? { reply_markup: { inline_keyboard: opts.keyboard.inline_keyboard } } : {}),
    }),
  });
  if (!resp.ok) throw new Error(`Telegram sendMessage failed: ${resp.status} ${await resp.text()}`);
}

export { API as TELEGRAM_API };
