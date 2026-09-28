import type { Route } from "./store.js";

export type Site = "redbus" | "cleartrip";
export type SiteChoice = Site | "both";

export interface Bus {
  operator: string;
  departure: string;
  price: number;
}

export interface ScrapedResult {
  site: Site;
  min: number | null;
  count: number;
  cheapest: Bus[];
  note?: string;
}

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
