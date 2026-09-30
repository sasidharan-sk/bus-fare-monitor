import { InlineKeyboard } from "grammy";
import { bookingUrl } from "./urls.js";
import type { Site } from "./types.js";

export { bookingUrl } from "./urls.js";

export function bookKeyboard(site: Site, from: string, to: string, date: string): InlineKeyboard {
  return new InlineKeyboard().url(
    site === "cleartrip" ? "Open on ClearTrip" : "Book on RedBus",
    bookingUrl(site, from, to, date),
  );
}
