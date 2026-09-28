import { chromium, type Browser, type Page } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { OWN_PROXY_URL } from "../config.js";
import type { Bus, ScrapedResult } from "../types.js";
import { pointMatches } from "./match.js";
import { dumpPayload } from "./dump.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

const LAUNCH_ARGS = ["--disable-blink-features=AutomationControlled"];

const BLOCK_RE = /just a moment|attention required|you have been blocked|cf-chl/i;

const BROWSER_HEADERS: Record<string, string> = {
  "user-agent": UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "sec-ch-ua": '"Chromium";v="153", "Not(A:Brand";v="24", "Google Chrome";v="153"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
};

const viaTranslate = (url: string): string => {
  const u = new URL(url);
  const params = u.searchParams.toString();
  const qs = params ? `${params}&` : "";
  return `https://${u.hostname.replace(/\./g, "-")}.translate.goog${u.pathname}` +
    `${qs}_x_tr_sl=auto&_x_tr_tl=en&_x_tr_hl=en`;
};

const viaReef = (url: string): string =>
  `https://reef-proxy.onrender.com/get?url=${encodeURIComponent(url)}`;

const viaOwn = (url: string): string =>
  `${OWN_PROXY_URL.replace(/\/$/, "")}/?url=${encodeURIComponent(url)}`;

async function tryFetch(
  url: string,
): Promise<{ ok: true; text: string } | { ok: false; status: string }> {
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { ok: false, status: String(res.status) };
    return { ok: true, text: await res.text() };
  } catch (exc) {
    return { ok: false, status: (exc as Error).message.slice(0, 60) };
  }
}

const slug = (city: string): string =>
  city.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const SEO_URL = (from: string, to: string) =>
  `https://www.cleartrip.com/bus-tickets/${slug(from)}-to-${slug(to)}/`;

const RESULTS_URL = (fromId: number, toId: number, from: string, to: string, date: string) =>
  `https://www.cleartrip.com/bus/results?fromCity=${fromId}&toCity=${toId}` +
  `&journeyDate=${date}&fromCityName=${encodeURIComponent(from)}&toCityName=${encodeURIComponent(to)}`;

const idCache = new Map<string, { fromId: number; toId: number }>();
const ID_CACHE_FILE = new URL("../../city-ids.json", import.meta.url);

function loadIdCache(): void {
  try {
    const raw = JSON.parse(readFileSync(ID_CACHE_FILE, "utf8")) as Record<string, { fromId: number; toId: number }>;
    for (const [k, v] of Object.entries(raw)) idCache.set(k, v);
  } catch {
    /* no cache yet */
  }
}

function saveIdCache(): void {
  try {
    writeFileSync(ID_CACHE_FILE, JSON.stringify(Object.fromEntries(idCache), null, 2));
  } catch (exc) {
    console.error("city id cache save failed:", exc);
  }
}

loadIdCache();

interface RawBus {
  deptTime?: string;
  fares?: Array<{ total?: number }>;
  meta?: { operatorName?: string };
  pickups?: string[];
  dropOffs?: string[];
}

export function extractBuses(html: string): RawBus[] {
  let parsed: RawBus[];
  try {
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
    parsed = JSON.parse(raw) as RawBus[];
    if (!Array.isArray(parsed)) throw new Error("ClearTrip: unexpected bus list shape");
    return parsed;
  } catch (exc) {
    dumpPayload("cleartrip", html);
    throw exc;
  }
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

export function parseResult(
  html: string,
  windows: string[],
  pickups: string[] = [],
  dropoffs: string[] = [],
): ScrapedResult {
  const buses: Bus[] = [];
  for (const raw of extractBuses(html)) {
    const fares = raw.fares ?? [];
    if (fares.length === 0) continue;
    const prices = fares.map((f) => f.total).filter((n): n is number => typeof n === "number");
    if (prices.length === 0) continue;
    const dep = raw.deptTime ?? "";
    const hour = departureHour(dep);
    if (windows.length > 0 && hour !== null && !inWindows(hour, windows)) continue;
    if (!pointMatches(raw.pickups, pickups)) continue;
    if (!pointMatches(raw.dropOffs, dropoffs)) continue;
    buses.push({ operator: raw.meta?.operatorName ?? "Unknown", departure: dep, price: Math.min(...prices) });
  }
  if (buses.length === 0) {
    return { site: "cleartrip", min: null, count: 0, cheapest: [], note: "No buses match your time window / point filters" };
  }
  buses.sort((a, b) => a.price - b.price);
  return { site: "cleartrip", min: buses[0].price, count: buses.length, cheapest: buses.slice(0, 3) };
}

export class CleartripScraper {
  private browser?: Browser;
  private page?: Page;
  private ready?: Promise<void>;

  private ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        this.browser = await chromium.launch({ channel: "chrome", headless: true, args: LAUNCH_ARGS });
        this.page = await this.browser.newPage({ userAgent: UA });
      })();
    }
    return this.ready;
  }

  private async get(url: string): Promise<string> {
    const attempts: string[] = [];

    const direct = await tryFetch(url);
    if (direct.ok) return direct.text;
    attempts.push(`direct ${direct.status}`);

    if (OWN_PROXY_URL) {
      const own = await tryFetch(viaOwn(url));
      if (own.ok) return own.text;
      attempts.push(`own ${own.status}`);
    }

    let reef = await tryFetch(viaReef(url));
    if (!reef.ok && reef.status === "429") {
      await new Promise((r) => setTimeout(r, 20_000));
      reef = await tryFetch(viaReef(url));
    }
    if (reef.ok) return reef.text;
    attempts.push(`reef ${reef.status}`);

    const relay = await tryFetch(viaTranslate(url));
    if (relay.ok) return relay.text;
    attempts.push(`relay ${relay.status}`);

    try {
      await this.ensure();
      const res = await this.page!.goto(url, { timeout: 60_000, waitUntil: "domcontentloaded" });
      let html = await this.page!.content();
      if (BLOCK_RE.test(html)) {
        await this.page!.waitForTimeout(8_000);
        html = await this.page!.content();
      }
      const status = res?.status() ?? 0;
      if (BLOCK_RE.test(html)) throw new Error(`blocked (${status || 403})`);
      if (status >= 400) throw new Error(`HTTP ${status}`);
      return html;
    } catch (exc) {
      attempts.push(`browser ${(exc as Error).message}`);
    }
    throw new Error(`ClearTrip failed: ${attempts.join("; ")}`);
  }

  private async resolveIds(from: string, to: string): Promise<{ fromId: number; toId: number }> {
    const key = `${slug(from)}|${slug(to)}`;
    const hit = idCache.get(key);
    if (hit) return hit;
    const html = await this.get(SEO_URL(from, to));
    const fromId = html.match(/\\"fromCityId\\":(\d+)/);
    const toId = html.match(/\\"toCityId\\":(\d+)/);
    if (!fromId || !toId) {
      dumpPayload("cleartrip-seo", html);
      throw new Error(`ClearTrip: route ${from} → ${to} not found`);
    }
    const ids = { fromId: Number(fromId[1]), toId: Number(toId[1]) };
    idCache.set(key, ids);
    saveIdCache();
    return ids;
  }

  async fetch(
    from: string,
    to: string,
    date: string,
    windows: string[] = [],
    pickups: string[] = [],
    dropoffs: string[] = [],
  ): Promise<ScrapedResult> {
    const { fromId, toId } = await this.resolveIds(from, to);
    const html = await this.get(RESULTS_URL(fromId, toId, from, to, date));
    return parseResult(html, windows, pickups, dropoffs);
  }

  async points(from: string, to: string, date: string): Promise<{ pickups: string[]; dropoffs: string[] }> {
    const { fromId, toId } = await this.resolveIds(from, to);
    const html = await this.get(RESULTS_URL(fromId, toId, from, to, date));
    const pu = new Map<string, number>();
    const dp = new Map<string, number>();
    for (const raw of extractBuses(html)) {
      for (const p of raw.pickups ?? []) pu.set(p, (pu.get(p) ?? 0) + 1);
      for (const d of raw.dropOffs ?? []) dp.set(d, (dp.get(d) ?? 0) + 1);
    }
    const top = (m: Map<string, number>): string[] =>
      [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
    return { pickups: top(pu), dropoffs: top(dp) };
  }

  async stop(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
    this.page = undefined;
    this.ready = undefined;
  }
}
