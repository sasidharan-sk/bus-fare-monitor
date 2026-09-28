import { mkdirSync, writeFileSync } from "node:fs";

export function dumpPayload(site: string, payload: string): void {
  try {
    mkdirSync("debug", { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = `debug/${site}-${stamp}.txt`;
    writeFileSync(file, payload.slice(0, 5_000_000), "utf-8");
    console.error(`parse-failure payload saved to ${file}`);
  } catch (exc) {
    console.error("dumpPayload failed:", exc);
  }
}
