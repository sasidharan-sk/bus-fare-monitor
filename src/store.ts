import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PRICES_FILE, ROUTES_FILE } from "./config.js";

export interface Route {
  id: number;
  source: string;
  destination: string;
  date: string;
  windows: string[];
}

export interface PriceRecord {
  min: number;
  checked_at: string;
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

export function addRoute(source: string, destination: string, date: string, windows: string[]): Route {
  const routes = loadRoutes();
  const id = routes.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  const route: Route = { id, source, destination, date, windows: [...windows].sort() };
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

export function routeKey(source: string, destination: string, date: string, windows: string[]): string {
  const base = `${source}|${destination}|${date}`;
  return windows.length > 0 ? `${base}|${[...windows].sort().join(",")}` : base;
}

export function loadPrices(): Record<string, PriceRecord> {
  return readJson<Record<string, PriceRecord>>(PRICES_FILE, {});
}

export function savePrices(prices: Record<string, PriceRecord>): void {
  writeJson(PRICES_FILE, prices);
}
