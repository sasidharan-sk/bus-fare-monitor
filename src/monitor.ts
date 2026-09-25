import { PRICE_DROP_THRESHOLD, resolveCity } from "./config.js";
import { send } from "./alerts.js";
import { dropText, summaryText } from "./messages.js";
import { loadPrices, loadRoutes, savePrices, routeKey } from "./store.js";
import { CleartripScraper } from "./scraper/cleartrip.js";
import { RedbusScraper } from "./scraper/redbus.js";
import type { CheckResult, RouteResult, Site, ScrapedResult } from "./types.js";

let running = false;

const siteOf = (r: { site?: Site }): Site => r.site ?? "redbus";

export async function runCheck(announce = false): Promise<CheckResult> {
  if (running) return { status: "busy", results: [], errors: [] };
  running = true;
  try {
    const routes = loadRoutes();
    if (routes.length === 0) return { status: "empty", results: [], errors: [] };

    const prices = loadPrices();
    const results: RouteResult[] = [];
    const errors: string[] = [];

    const needsRedbus = routes.some((r) => siteOf(r) === "redbus");
    const needsCleartrip = routes.some((r) => siteOf(r) === "cleartrip");
    const redbus = needsRedbus ? new RedbusScraper() : null;
    const cleartrip = needsCleartrip ? new CleartripScraper() : null;

    try {
      if (redbus) await redbus.start();
      for (const route of routes) {
        const src = resolveCity(route.source);
        const dst = resolveCity(route.destination);
        if (!src || !dst) {
          errors.push(`Unknown city on route #${route.id}`);
          continue;
        }
        const site = siteOf(route);
        const key = routeKey(site, src.name, dst.name, route.date, route.windows);
        try {
          let data: ScrapedResult;
          if (site === "cleartrip") {
            data = await cleartrip!.fetch(src.name, dst.name, route.date, route.windows);
          } else {
            data = await redbus!.fetch(src.id, dst.id, route.date, route.windows);
          }
          const checkedAt = new Date().toISOString().slice(0, 19);
          const prev = prices[key];
          if (data.min !== null) {
            prices[key] = { min: data.min, checked_at: checkedAt };
            if (prev && prev.min - data.min >= PRICE_DROP_THRESHOLD) {
              await send(dropText(src.name, dst.name, route, prev.min, data));
            }
          }
          results.push({
            route,
            source: src.name,
            destination: dst.name,
            data,
            prevMin: prev?.min ?? null,
          });
        } catch (exc) {
          errors.push(`${src.name} → ${dst.name} (${route.date}): ${exc}`);
        }
      }
      savePrices(prices);
    } finally {
      await redbus?.stop();
    }

    if (announce && results.length > 0) {
      await send(summaryText(results, errors));
    }
    return { status: "ok", results, errors };
  } finally {
    running = false;
  }
}
