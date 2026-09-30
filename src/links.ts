import { InlineKeyboard } from "grammy";
import { resolveCity } from "./config.js";
import type { Site } from "./types.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const slug = (city: string): string =>
  city.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function redbusUrl(from: string, to: string, date: string): string {
  const src = resolveCity(from);
  const dst = resolveCity(to);
  const [y, m, d] = date.split("-");
  const onward = `${d}-${MONTHS[Number(m) - 1]}-${y}`;
  if (!src || !dst) return "https://www.redbus.in/";
  const params = new URLSearchParams({
    fromCityName: src.name,
    fromCityId: src.id,
    toCityName: dst.name,
    toCityId: dst.id,
    onward,
    srcCountry: "IND",
    destCountry: "IND",
    opId: "0",
    busType: "Any",
  });
  return `https://www.redbus.in/bus-tickets/${slug(from)}-to-${slug(to)}?${params}`;
}

function cleartripUrl(from: string, to: string): string {
  return `https://www.cleartrip.com/bus-tickets/${slug(from)}-to-${slug(to)}/`;
}

export function bookingUrl(site: Site, from: string, to: string, date: string): string {
  return site === "cleartrip" ? cleartripUrl(from, to) : redbusUrl(from, to, date);
}

export function bookKeyboard(site: Site, from: string, to: string, date: string): InlineKeyboard {
  return new InlineKeyboard().url(
    site === "cleartrip" ? "Open on ClearTrip" : "Book on RedBus",
    bookingUrl(site, from, to, date),
  );
}
