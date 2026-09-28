import { CITY_NAMES, WINDOW_LABELS } from "./config.js";
import type { Route } from "./store.js";
import type { RouteResult, ScrapedResult, Site, SiteChoice } from "./types.js";

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

export const fmtTime = (departure: string): string => departure.slice(11, 16);

export const fmtRs = (n: number): string => `Rs.${n}`;

export function fmtWindows(route: Route): string {
  if (route.windows.length === 0) return "All day";
  return route.windows.map((w) => WINDOW_LABELS[w] ?? w).join(", ");
}

export const SITE_LABELS: Record<Site, string> = { redbus: "RedBus", cleartrip: "ClearTrip" };

export const siteChoiceLabel = (site?: SiteChoice): string =>
  site === "both" ? "RedBus + ClearTrip" : SITE_LABELS[site ?? "redbus"];

const siteTag = (site?: SiteChoice): string =>
  site === undefined ? "" : ` · ${siteChoiceLabel(site)}`;

const siteTitle = (site: Site): string => `<b><u>${SITE_LABELS[site].toUpperCase()}</u></b>`;

const orderedGroups = <T>(items: T[], siteOf: (item: T) => Site): Array<[Site, T[]]> => {
  const groups: Array<[Site, T[]]> = [];
  for (const site of ["redbus", "cleartrip"] as const) {
    const members = items.filter((item) => siteOf(item) === site);
    if (members.length > 0) groups.push([site, members]);
  }
  return groups;
};

const routeLine = (source: string, destination: string, date: string, site?: SiteChoice): string =>
  `<b>${esc(source)} → ${esc(destination)}</b> · ${fmtDate(date)}${siteTag(site)}`;

export const HELP = [
  "<b>Bus Fare Monitor</b>",
  "",
  "<code>/add</code> — watch a new route (site, city, date, time & pick-up/drop points)",
  "<code>/list</code> — show watched routes",
  "<code>/remove</code> — stop watching (multi-select picker)",
  "<code>/check</code> — check prices now",
  "<code>/help</code> — this message",
  "",
  "Or type directly:",
  "<code>/add bangalore salem 2026-10-05</code> (RedBus)",
  "<code>/add ct bangalore salem 2026-10-05</code> (ClearTrip)",
  "<code>/add both bangalore salem 2026-10-05</code> (both providers)",
].join("\n");

export const ONLINE = [
  "<b>Bus Fare Monitor</b> is online",
  `Checking every <b>2h</b> · drop threshold <b>Rs.50</b>`,
  "Send <code>/add</code> to start watching routes.",
].join("\n");

export const PICK_SITE = "<b>New route</b>\nWhere should I check prices?";
export const PICK_FROM = "<b>New route</b>\nWhere are you travelling from?";
export const pickTo = (from: string): string => `From <b>${esc(from)}</b>\nWhere to?`;
export const pickDate = (from: string, to: string, site?: SiteChoice): string =>
  `<b>${esc(from)} → ${esc(to)}</b> · ${siteChoiceLabel(site)}\nPick your travel date:`;
export const pickTime = (from: string, to: string, date: string, site?: SiteChoice): string =>
  `${routeLine(from, to, date, site)}\nPick departure time <i>(tap to toggle, pick several)</i>:`;
export const CANCELLED = "Cancelled. Send <code>/add</code> to start again.";
export const SESSION_EXPIRED = "Session expired. Send <code>/add</code> again.";
export const LOADING_POINTS = "Loading pick-up & drop points for this route…";
export const pickPickup = (from: string, to: string): string =>
  `<b>${esc(from)} → ${esc(to)}</b>\nSelect pick-up point(s) <i>(tap to toggle, Done = any point)</i>:`;
export const pickDropoff = (from: string, to: string): string =>
  `<b>${esc(from)} → ${esc(to)}</b>\nSelect drop point(s) <i>(tap to toggle, Done = any point)</i>:`;

export function fmtPoints(route: Route): string {
  const parts: string[] = [];
  if (route.pickups?.length) parts.push(`Pickup: ${route.pickups.map(esc).join(", ")}`);
  if (route.dropoffs?.length) parts.push(`Drop: ${route.dropoffs.map(esc).join(", ")}`);
  return parts.join("\n");
}

export function addedText(route: Route): string {
  const pts = fmtPoints(route);
  return [
    `<b>Now watching #${route.id}</b>`,
    routeLine(route.source, route.destination, route.date, route.site),
    `Time: <i>${esc(fmtWindows(route))}</i>`,
    ...(pts ? [`<i>${pts}</i>`] : []),
  ].join("\n");
}

export function addedTexts(routes: Route[]): string {
  if (routes.length === 1) return addedText(routes[0]);
  const lines = [`<b>Now watching ${routes.length} watches</b>`];
  for (const r of routes) {
    lines.push(`<b>#${r.id}</b>  ${routeLine(r.source, r.destination, r.date, r.site)}`);
    lines.push(`     <i>${esc(fmtWindows(r))}</i>`);
    const pts = fmtPoints(r);
    if (pts) lines.push(`     <i>${pts}</i>`);
  }
  return lines.join("\n");
}

export function listText(routes: Route[]): string {
  if (routes.length === 0) return "No routes yet. Add one with <code>/add</code>";
  const lines = [`<b>Watched routes (${routes.length})</b>`];
  for (const [site, group] of orderedGroups(routes, (r) => r.site ?? "redbus")) {
    lines.push("", siteTitle(site), "");
    for (const r of group) {
      lines.push(`<b>#${r.id}</b>  ${routeLine(r.source, r.destination, r.date)}`);
      lines.push(`     <i>${esc(fmtWindows(r))}</i>`);
      const pts = fmtPoints(r);
      if (pts) lines.push(`     <i>${pts}</i>`);
    }
  }
  return lines.join("\n");
}

export const removedText = (id: number): string => `Removed <b>#${id}</b>.`;
export const notFoundText = (id: number): string => `No route with id <b>#${id}</b>.`;
export const removePickText = (note?: string): string =>
  [note ? `${note}\n` : "", "<b>Remove routes</b>", "Tap to select, then <b>Remove selected</b>:"].join("\n");
export const removeDoneText = "Done. Send <code>/list</code> to review your routes.";
export const NO_ROUTES = "No routes to check. Add one first with <code>/add</code>.";
export const CHECKING = "Checking prices…";
export const UNAUTHORIZED = "Unauthorized chat.";

export const unknownCityText = (city: string): string =>
  `Unknown city <b>${esc(city)}</b>. Known: ${CITY_NAMES.map(esc).join(", ")}`;
export const ADD_USAGE =
  "Usage: <code>/add &lt;from&gt; &lt;to&gt; &lt;YYYY-MM-DD&gt;</code>" +
  " — prefix <code>ct</code> for ClearTrip or <code>both</code> for both providers," +
  " e.g. <code>/add both bangalore salem 2026-10-05</code>" +
  " — or just <code>/add</code> to use the pickers.";
export const badDateText =
  "Date must be <code>YYYY-MM-DD</code> and in the future, e.g. <code>2026-10-05</code>";
export const SAME_CITY = "Source and destination are the same.";
export const errorText = (e: unknown): string => `<b>Check failed</b>\n<code>${esc(String(e))}</code>`;

export function dropText(
  source: string,
  destination: string,
  route: Route,
  prevMin: number,
  data: ScrapedResult,
): string {
  const now = data.min ?? 0;
  const drop = prevMin - now;
  const b = data.cheapest[0];
  return [
    `<b>PRICE DROP · −${fmtRs(drop)}</b>`,
    routeLine(source, destination, route.date, route.site ?? "redbus"),
    `<i>${esc(fmtWindows(route))}</i>`,
    "",
    `<s>${fmtRs(prevMin)}</s> → <b>${fmtRs(now)}</b>`,
    `Cheapest: ${esc(b.operator)} · dep <code>${fmtTime(b.departure)}</code>`,
    `${data.count} buses checked`,
  ].join("\n");
}

export function summaryText(results: RouteResult[], errors: string[]): string {
  const lines: string[] = [`<b>Price check done</b>`];
  for (const [site, group] of orderedGroups(results, (r) => r.route.site ?? "redbus")) {
    lines.push("", siteTitle(site));
    for (const r of group) {
      lines.push("");
      lines.push(routeLine(r.source, r.destination, r.route.date));
      lines.push(`<i>${esc(fmtWindows(r.route))}</i>`);
      if (r.data.min === null) {
        lines.push(r.data.note ?? "No buses in selected time window");
        continue;
      }
      let price = `Min: <b>${fmtRs(r.data.min)}</b>`;
      if (r.prevMin !== null) {
        const diff = r.prevMin - r.data.min;
        price =
          diff > 0
            ? `Min: <s>${fmtRs(r.prevMin)}</s> <b>${fmtRs(r.data.min)}</b> <b>(−${fmtRs(diff)})</b>`
            : diff < 0
              ? `Min: <s>${fmtRs(r.prevMin)}</s> <b>${fmtRs(r.data.min)}</b> <i>(+${fmtRs(-diff)})</i>`
              : `Min: <b>${fmtRs(r.data.min)}</b> <i>(unchanged)</i>`;
      }
      lines.push(price);
      const b = r.data.cheapest[0];
      lines.push(`Cheapest: ${esc(b.operator)} · dep <code>${fmtTime(b.departure)}</code>`);
      lines.push(`<code>${r.data.count}</code> buses found`);
    }
  }
  for (const e of errors) {
    lines.push("");
    lines.push(`<b>ERROR:</b> <code>${esc(e)}</code>`);
  }
  return lines.join("\n");
}
