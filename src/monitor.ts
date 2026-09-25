import { PRICE_DROP_THRESHOLD, resolveCity, WINDOW_LABELS } from "./config.js";
import { send } from "./alerts.js";
import { loadPrices, loadRoutes, savePrices, routeKey, type Route } from "./store.js";
import { RedbusScraper, type ScrapedResult } from "./scraper/redbus.js";

export interface RouteResult {
  route: Route;
  source: string;
  destination: string;
  data: ScrapedResult;
  prevMin: number | null;
}

export interface CheckResult {
  status: "ok" | "busy" | "empty";
  results: RouteResult[];
  errors: string[];
}

let running = false;

export async function runCheck(announce = false): Promise<CheckResult> {
  if (running) return { status: "busy", results: [], errors: [] };
  running = true;
  try {
    const routes = loadRoutes();
    if (routes.length === 0) return { status: "empty", results: [], errors: [] };

    const prices = loadPrices();
    const results: RouteResult[] = [];
    const errors: string[] = [];
    const scraper = new RedbusScraper();

    try {
      await scraper.start();
      for (const route of routes) {
        const src = resolveCity(route.source);
        const dst = resolveCity(route.destination);
        if (!src || !dst) {
          errors.push(`Unknown city on route #${route.id}`);
          continue;
        }
        const key = routeKey(src.name, dst.name, route.date, route.windows);
        let data: ScrapedResult;
        try {
          data = await scraper.fetch(src.id, dst.id, route.date, route.windows);
        } catch (exc) {
          errors.push(`${src.name} -> ${dst.name} (${route.date}): ${exc}`);
          continue;
        }
        const checkedAt = new Date().toISOString().slice(0, 19);
        const prev = prices[key];
        if (data.min !== null) {
          prices[key] = { min: data.min, checked_at: checkedAt };
          if (prev && prev.min - data.min >= PRICE_DROP_THRESHOLD) {
            await send(formatDrop(src.name, dst.name, route, prev.min, data));
          }
        }
        results.push({
          route,
          source: src.name,
          destination: dst.name,
          data,
          prevMin: prev?.min ?? null,
        });
      }
      savePrices(prices);
    } finally {
      await scraper.stop();
    }

    if (announce && results.length > 0) {
      await send(formatSummary(results, errors));
    }
    return { status: "ok", results, errors };
  } finally {
    running = false;
  }
}

function windowTag(route: Route): string {
  if (route.windows.length === 0) return "";
  return ` [${route.windows.map((w) => WINDOW_LABELS[w] ?? w).join(", ")}]`;
}

function formatDrop(src: string, dst: string, route: Route, oldMin: number, data: ScrapedResult): string {
  const b = data.cheapest[0];
  return [
    `PRICE DROP - ${src} -> ${dst} (${route.date})${windowTag(route)}`,
    `RedBus min: Rs.${oldMin} -> Rs.${data.min} (Rs.${oldMin - (data.min ?? 0)} off)`,
    `Cheapest: ${b.operator} ${b.departure.slice(11, 16)} Rs.${b.price}`,
    `Buses found: ${data.count}`,
  ].join("\n");
}

export function formatSummary(results: RouteResult[], errors: string[]): string {
  const lines = ["Manual check done:"];
  for (const r of results) {
    const tag = windowTag(r.route);
    if (r.data.min === null) {
      lines.push(`${r.source} -> ${r.destination} (${r.route.date})${tag}: no buses in selected time window`);
      continue;
    }
    let change = "";
    if (r.prevMin !== null) {
      const diff = r.prevMin - r.data.min;
      change = ` (was Rs.${r.prevMin}, ${diff > 0 ? "-" : "+"}Rs.${Math.abs(diff)})`;
    }
    const b = r.data.cheapest[0];
    lines.push(
      `${r.source} -> ${r.destination} (${r.route.date})${tag}: Rs.${r.data.min}${change} | ${b.operator} | ${r.data.count} buses`,
    );
  }
  for (const e of errors) lines.push(`ERROR: ${e}`);
  return lines.join("\n");
}
