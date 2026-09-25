import { chromium, type Browser, type Page } from "playwright";

const SEARCH_URL = (src: string, dst: string, doj: string) =>
  `https://www.redbus.in/rpw/api/searchResults?fromCity=${src}&toCity=${dst}&DOJ=${doj}` +
  "&limit=100&offset=0&meta=true&groupId=0&sectionId=0&sort=0&sortOrder=0" +
  "&from=initialLoad&getUuid=true&bT=1&isFilterApplied=false";

const LAUNCH_ARGS = ["--disable-http2", "--disable-blink-features=AutomationControlled"];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

export interface Bus {
  operator: string;
  departure: string;
  price: number;
}

export interface ScrapedResult {
  site: "redbus";
  min: number | null;
  count: number;
  cheapest: Bus[];
  note?: string;
}

interface RawInventory {
  travelsName?: string;
  departureTime?: string;
  fareList?: number[];
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

export function parseResult(data: RawResponse, windows: string[]): ScrapedResult {
  if (data.error !== undefined) throw new Error(`RedBus API error ${data.error}`);
  const inventories = data.data?.inventories ?? [];
  const buses: Bus[] = [];
  for (const inv of inventories) {
    const fares = inv.fareList ?? [];
    if (fares.length === 0) continue;
    const dep = inv.departureTime ?? "";
    const hour = departureHour(dep);
    if (windows.length > 0 && hour !== null && !inWindows(hour, windows)) continue;
    buses.push({ operator: inv.travelsName ?? "Unknown", departure: dep, price: Math.min(...fares) });
  }
  if (buses.length === 0) {
    return { site: "redbus", min: null, count: 0, cheapest: [], note: "No buses in selected time window" };
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

  async fetch(srcId: string, dstId: string, date: string, windows: string[] = []): Promise<ScrapedResult> {
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
    return parseResult(data as RawResponse, windows);
  }

  async stop(): Promise<void> {
    await this.browser?.close();
  }
}
