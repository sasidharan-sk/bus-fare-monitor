import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PRICES_FILE, ROUTES_FILE, resolveCity } from "./config.js";
import type { Site } from "./types.js";

export interface Route {
  id: number;
  source: string;
  destination: string;
  date: string;
  windows: string[];
  site?: Site;
  pickups?: string[];
  dropoffs?: string[];
  target?: number;
  paused?: boolean;
}

export interface PriceRecord {
  min: number;
  checked_at: string;
  target_armed?: boolean;
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

export function loadRoutes(): Route[] {
  return readJson<Route[]>(ROUTES_FILE, []);
}

export function saveRoutes(routes: Route[]): void {
  writeJson(ROUTES_FILE, routes);
}

const sortedPoints = (points: string[]): string[] =>
  points.map((p) => p.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));

export function addRoute(
  source: string,
  destination: string,
  date: string,
  windows: string[],
  site: Site = "redbus",
  pickups: string[] = [],
  dropoffs: string[] = [],
  target?: number,
): Route {
  const routes = loadRoutes();
  const id = routes.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  const route: Route = { id, source, destination, date, windows: [...windows].sort(), site };
  const pu = sortedPoints(pickups);
  const dp = sortedPoints(dropoffs);
  if (pu.length > 0) route.pickups = pu;
  if (dp.length > 0) route.dropoffs = dp;
  if (target !== undefined && target > 0) route.target = Math.round(target);
  routes.push(route);
  saveRoutes(routes);
  return route;
}

export function removeRoute(id: number): boolean {
  const routes = loadRoutes();
  const kept = routes.filter((r) => r.id !== id);
  if (kept.length === routes.length) return false;
  saveRoutes(kept);
  return true;
}

export function updateRoute(id: number, patch: Partial<Route>): Route | null {
  const routes = loadRoutes();
  const idx = routes.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const updated: Route = { ...routes[idx], ...patch, id: routes[idx].id };
  if (updated.paused === false) delete updated.paused;
  routes[idx] = updated;
  saveRoutes(routes);
  return updated;
}

export function routeKey(
  site: Site,
  source: string,
  destination: string,
  date: string,
  windows: string[],
  pickups: string[] = [],
  dropoffs: string[] = [],
): string {
  const base = `${source}|${destination}|${date}`;
  const win = windows.length > 0 ? `|${[...windows].sort().join(",")}` : "";
  const pts =
    (pickups.length > 0 ? `|bp:${[...pickups].sort().join(",")}` : "") +
    (dropoffs.length > 0 ? `|dp:${[...dropoffs].sort().join(",")}` : "");
  return `${site}:${base}${win}${pts}`;
}

export function loadPrices(): Record<string, PriceRecord> {
  return readJson<Record<string, PriceRecord>>(PRICES_FILE, {});
}

export function savePrices(prices: Record<string, PriceRecord>): void {
  const active = new Set(
    loadRoutes().map((r) =>
      routeKey(
        r.site ?? "redbus",
        resolveCity(r.source)?.name ?? r.source,
        resolveCity(r.destination)?.name ?? r.destination,
        r.date,
        r.windows,
        r.pickups ?? [],
        r.dropoffs ?? [],
      ),
    ),
  );
  const pruned: Record<string, PriceRecord> = {};
  for (const [key, rec] of Object.entries(prices)) {
    if (active.has(key)) pruned[key] = rec;
  }
  writeJson(PRICES_FILE, pruned);
}
