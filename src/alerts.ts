import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from "./config.js";

const API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

export async function send(text: string, chatId: string = TELEGRAM_CHAT_ID): Promise<void> {
  const resp = await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  if (!resp.ok) throw new Error(`Telegram sendMessage failed: ${resp.status} ${await resp.text()}`);
}

export { API as TELEGRAM_API };
