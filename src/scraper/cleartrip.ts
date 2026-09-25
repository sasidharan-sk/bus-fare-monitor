import type { Bus, ScrapedResult } from "../types.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

const slug = (city: string): string =>
  city.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const SEO_URL = (from: string, to: string) =>
  `https://www.cleartrip.com/bus-tickets/${slug(from)}-to-${slug(to)}/`;

const RESULTS_URL = (fromId: number, toId: number, from: string, to: string, date: string) =>
  `https://www.cleartrip.com/bus/results?fromCity=${fromId}&toCity=${toId}` +
  `&journeyDate=${date}&fromCityName=${encodeURIComponent(from)}&toCityName=${encodeURIComponent(to)}`;

async function get(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`ClearTrip HTTP ${res.status}`);
  return res.text();
}

const idCache = new Map<string, { fromId: number; toId: number }>();

async function resolveIds(from: string, to: string): Promise<{ fromId: number; toId: number }> {
  const key = `${slug(from)}|${slug(to)}`;
  const hit = idCache.get(key);
  if (hit) return hit;
  const html = await get(SEO_URL(from, to));
  const fromId = html.match(/\\"fromCityId\\":(\d+)/);
  const toId = html.match(/\\"toCityId\\":(\d+)/);
  if (!fromId || !toId) throw new Error(`ClearTrip: route ${from} → ${to} not found`);
  const ids = { fromId: Number(fromId[1]), toId: Number(toId[1]) };
  idCache.set(key, ids);
  return ids;
}

interface RawBus {
  deptTime?: string;
  fares?: Array<{ total?: number }>;
  meta?: { operatorName?: string };
}

export function extractBuses(html: string): RawBus[] {
  const anchor = html.indexOf("totalAvailBuses");
  const marker = 'buses\\":[';
  const at = html.indexOf(marker, anchor === -1 ? 0 : anchor);
  if (at === -1) throw new Error("ClearTrip: bus list not found in page");
  const start = at + marker.length - 1;

  let depth = 0;
  let inString = false;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (c === "\\") {
      const next = html[i + 1];
      if (next === '"') inString = !inString;
      i++;
      continue;
    }
    if (inString) continue;
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) throw new Error("ClearTrip: bus list truncated");

  const raw = html.slice(start, end).replace(/\\"/g, '"');
  const parsed = JSON.parse(raw) as RawBus[];
  if (!Array.isArray(parsed)) throw new Error("ClearTrip: unexpected bus list shape");
  return parsed;
}

function departureHour(dep: string): number | null {
  const h = Number(dep.slice(11, 13));
  return Number.isInteger(h) && h >= 0 && h < 24 ? h : null;
}

function inWindows(hour: number, windows: string[]): boolean {
  return windows.some((w) => {
    const [lo, hi] = w.split("-").map(Number);
    return hour >= lo && hour < hi;
  });
}

export function parseResult(html: string, windows: string[]): ScrapedResult {
  const buses: Bus[] = [];
  for (const raw of extractBuses(html)) {
    const fares = raw.fares ?? [];
    if (fares.length === 0) continue;
    const prices = fares.map((f) => f.total).filter((n): n is number => typeof n === "number");
    if (prices.length === 0) continue;
    const dep = raw.deptTime ?? "";
    const hour = departureHour(dep);
    if (windows.length > 0 && hour !== null && !inWindows(hour, windows)) continue;
    buses.push({ operator: raw.meta?.operatorName ?? "Unknown", departure: dep, price: Math.min(...prices) });
  }
  if (buses.length === 0) {
    return { site: "cleartrip", min: null, count: 0, cheapest: [], note: "No buses in selected time window" };
  }
  buses.sort((a, b) => a.price - b.price);
  return { site: "cleartrip", min: buses[0].price, count: buses.length, cheapest: buses.slice(0, 3) };
}

export class CleartripScraper {
  async fetch(from: string, to: string, date: string, windows: string[] = []): Promise<ScrapedResult> {
    const { fromId, toId } = await resolveIds(from, to);
    const html = await get(RESULTS_URL(fromId, toId, from, to, date));
    return parseResult(html, windows);
  }
}
