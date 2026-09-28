import { resolveCity } from "./config.js";
import { CleartripScraper } from "./scraper/cleartrip.js";
import { RedbusScraper } from "./scraper/redbus.js";
import type { Site, SiteChoice } from "./types.js";

export interface RoutePoints {
  pickups: string[];
  dropoffs: string[];
}

const MAX_OPTIONS = 24;

function union(target: Map<string, number>, names: string[]): void {
  for (const n of names) target.set(n, (target.get(n) ?? 0) + 1);
}

const top = (m: Map<string, number>): string[] =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_OPTIONS)
    .map(([name]) => name);

export async function collectPoints(
  choice: SiteChoice,
  from: string,
  to: string,
  date: string,
): Promise<RoutePoints> {
  const src = resolveCity(from);
  const dst = resolveCity(to);
  if (!src || !dst) return { pickups: [], dropoffs: [] };

  const pu = new Map<string, number>();
  const dp = new Map<string, number>();
  const sites: Site[] = choice === "both" ? ["redbus", "cleartrip"] : [choice];

  for (const site of sites) {
    try {
      if (site === "redbus") {
        const rb = new RedbusScraper();
        try {
          await rb.start();
          const p = await rb.points(src.id, dst.id, date);
          union(pu, p.pickups);
          union(dp, p.dropoffs);
        } finally {
          await rb.stop();
        }
      } else {
        const ct = new CleartripScraper();
        try {
          const p = await ct.points(src.name, dst.name, date);
          union(pu, p.pickups);
          union(dp, p.dropoffs);
        } finally {
          await ct.stop();
        }
      }
    } catch (exc) {
      console.error(`points load failed for ${site}:`, exc);
    }
  }
  return { pickups: top(pu), dropoffs: top(dp) };
}
