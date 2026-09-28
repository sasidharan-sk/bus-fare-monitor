import { chromium, type Browser, type Page } from "playwright";
import type { ScrapedResult } from "../types.js";
import { pointMatches } from "./match.js";
import { dumpPayload } from "./dump.js";

const SEARCH_URL = (src: string, dst: string, doj: string) =>
  `https://www.redbus.in/rpw/api/searchResults?fromCity=${src}&toCity=${dst}&DOJ=${doj}` +
  "&limit=100&offset=0&meta=true&groupId=0&sectionId=0&sort=0&sortOrder=0" +
  "&from=initialLoad&getUuid=true&bT=1&isFilterApplied=false";

const LAUNCH_ARGS = ["--disable-http2", "--disable-blink-features=AutomationControlled"];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

interface RawInventory {
  travelsName?: string;
  departureTime?: string;
  fareList?: number[];
  standardBpName?: string;
  standardDpName?: string;
}

interface RawResponse {
  error?: number;
  data?: { inventories?: RawInventory[] };
}

function toDoj(date: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m, d] = date.split("-").map(Number);
  return `${String(d).padStart(2, "0")}-${months[m - 1]}-${y}`;
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
  data: RawResponse,
  windows: string[],
  pickups: string[] = [],
  dropoffs: string[] = [],
): ScrapedResult {
  if (data.error !== undefined) throw new Error(`RedBus API error ${data.error}`);
  if (!data.data) {
    dumpPayload("redbus", JSON.stringify(data));
    throw new Error("RedBus: unexpected API payload shape");
  }
  const inventories = data.data.inventories ?? [];
  const buses: ScrapedResult["cheapest"] = [];
  for (const inv of inventories) {
    const fares = inv.fareList ?? [];
    if (fares.length === 0) continue;
    const dep = inv.departureTime ?? "";
    const hour = departureHour(dep);
    if (windows.length > 0 && hour !== null && !inWindows(hour, windows)) continue;
    if (!pointMatches(inv.standardBpName ? [inv.standardBpName] : undefined, pickups)) continue;
    if (!pointMatches(inv.standardDpName ? [inv.standardDpName] : undefined, dropoffs)) continue;
    buses.push({ operator: inv.travelsName ?? "Unknown", departure: dep, price: Math.min(...fares) });
  }
  if (buses.length === 0) {
    return { site: "redbus", min: null, count: 0, cheapest: [], note: "No buses match your time window / point filters" };
  }
  buses.sort((a, b) => a.price - b.price);
  return { site: "redbus", min: buses[0].price, count: buses.length, cheapest: buses.slice(0, 3) };
}

export class RedbusScraper {
  private browser!: Browser;
  private page!: Page;

  async start(): Promise<void> {
    this.browser = await chromium.launch({ channel: "chrome", headless: true, args: LAUNCH_ARGS });
    this.page = await this.browser.newPage({ userAgent: UA });
    await this.page.goto("https://www.redbus.in/", { timeout: 60_000, waitUntil: "domcontentloaded" });
  }

  private async search(srcId: string, dstId: string, date: string): Promise<RawResponse> {
    const url = SEARCH_URL(srcId, dstId, toDoj(date));
    const data = await this.page.evaluate(
      async (u: string) => {
        const r = await fetch(u, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!r.ok) return { error: r.status };
        return (await r.json()) as unknown;
      },
      url,
    );
    return data as RawResponse;
  }

  async fetch(
    srcId: string,
    dstId: string,
    date: string,
    windows: string[] = [],
    pickups: string[] = [],
    dropoffs: string[] = [],
  ): Promise<ScrapedResult> {
    const data = await this.search(srcId, dstId, date);
    return parseResult(data, windows, pickups, dropoffs);
  }

  async points(srcId: string, dstId: string, date: string): Promise<{ pickups: string[]; dropoffs: string[] }> {
    const data = await this.search(srcId, dstId, date);
    const pu = new Map<string, number>();
    const dp = new Map<string, number>();
    for (const inv of data.data?.inventories ?? []) {
      if (inv.standardBpName) pu.set(inv.standardBpName, (pu.get(inv.standardBpName) ?? 0) + 1);
      if (inv.standardDpName) dp.set(inv.standardDpName, (dp.get(inv.standardDpName) ?? 0) + 1);
    }
    const top = (m: Map<string, number>): string[] =>
      [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
    return { pickups: top(pu), dropoffs: top(dp) };
  }

  async stop(): Promise<void> {
    await this.browser?.close();
  }
}
