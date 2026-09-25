import { PRICE_DROP_THRESHOLD, resolveCity } from "./config.js";
import { send } from "./alerts.js";
import { dropText, summaryText } from "./messages.js";
import { loadPrices, loadRoutes, savePrices, routeKey } from "./store.js";
import { RedbusScraper } from "./scraper/redbus.js";
import type { CheckResult, RouteResult } from "./types.js";

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
        try {
          const data = await scraper.fetch(src.id, dst.id, route.date, route.windows);
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
      await scraper.stop();
    }

    if (announce && results.length > 0) {
      await send(summaryText(results, errors));
    }
    return { status: "ok", results, errors };
  } finally {
    running = false;
  }
}
