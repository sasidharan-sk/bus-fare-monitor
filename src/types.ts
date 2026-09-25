import type { Route } from "./store.js";
import type { ScrapedResult } from "./scraper/redbus.js";

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
