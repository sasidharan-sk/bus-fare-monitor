import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { FAIL_ALERT_AFTER, STATUS_FILE } from "./config.js";
import { send } from "./alerts.js";
import { failStreakText, recoveredText } from "./messages.js";
import type { Site } from "./types.js";

interface SiteStatus {
  fails: number;
  lastError?: string;
  lastOk?: string;
}

function load(): Record<string, SiteStatus> {
  if (!existsSync(STATUS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATUS_FILE, "utf-8")) as Record<string, SiteStatus>;
  } catch {
    return {};
  }
}

function save(st: Record<string, SiteStatus>): void {
  writeFileSync(STATUS_FILE, JSON.stringify(st, null, 2), "utf-8");
}

export async function recordSiteStatus(site: Site, ok: boolean, error?: string): Promise<void> {
  let st: Record<string, SiteStatus>;
  try {
    st = load();
  } catch {
    st = {};
  }
  const cur = st[site] ?? { fails: 0 };
  let notify: string | null = null;

  if (ok) {
    if (cur.fails >= FAIL_ALERT_AFTER) notify = recoveredText(site, cur.fails);
    st[site] = { fails: 0, lastOk: new Date().toISOString().slice(0, 19) };
  } else {
    const fails = cur.fails + 1;
    st[site] = {
      fails,
      lastError: (error ?? "unknown error").slice(0, 300),
      lastOk: cur.lastOk,
    };
    if (fails === FAIL_ALERT_AFTER) notify = failStreakText(site, fails, error ?? "unknown error");
  }

  try {
    save(st);
  } catch (exc) {
    console.error("check-status save failed:", exc);
  }
  if (notify !== null) {
    try {
      await send(notify);
    } catch (exc) {
      console.error("streak alert failed:", exc);
    }
  }
}
