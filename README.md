# Bus Fare Monitor

Telegram bot that watches bus fares on RedBus and alerts you when prices drop.

## Stack

- **TypeScript + Node.js** — strict-mode, ESM
- **grammY** (+ `@grammyjs/conversations`) — bot commands and the multi-step `/add` picker flow
- **Playwright** (headless Chrome) — RedBus blocks plain HTTP, so fares are fetched via an in-page `fetch`
- **dotenv** — config

## How it works

- One long-running process: grammY long-polling for commands + a scheduler
  that re-checks every `CHECK_INTERVAL_HOURS`.
- Routes live in `routes.json`, last-seen prices in `prices.json` (both gitignored).
- A route's minimum fare dropping by >= `PRICE_DROP_THRESHOLD` triggers a
  Telegram alert. Only buses inside the route's selected time windows are compared.
- ClearTrip is stubbed (blocked on office WiFi) — `src/scraper/cleartrip.ts` is
  the plug-in point for a second source.

## Setup

```bash
npm install
npm run build
cp .env.example .env   # fill TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
npm start
```

Dev mode: `npm run dev` (tsx, no build step).
Manual check: `npm run check`.

## Commands

| Command | Effect |
|---|---|
| `/add` | Watch a route — pickers for city, city, date (calendar), time windows |
| `/add <from> <to> <YYYY-MM-DD>` | Same, straight from text |
| `/list` | Show watched routes |
| `/remove <id>` | Stop watching a route |
| `/check` | Check prices immediately |
| `/help` | Usage |

Time windows: `12 AM - 6 AM`, `6 AM - 12 PM`, `12 PM - 6 PM`, `6 PM - 12 AM`
(multi-select; none selected = all day).

## Scripts

| Script | What it runs |
|---|---|
| `npm run build` | `tsc` → `dist/` |
| `npm start` | `node dist/bot.js` |
| `npm run dev` | `tsx src/bot.ts` |
| `npm run check` | One manual price check, prints summary |

## Structure

```
src/
  bot.ts            grammY bot: commands, /add conversation, scheduler
  monitor.ts        check loop, drop detection, alert/summary formatting
  scraper/redbus.ts Playwright fetch + fare parsing, time-window filter
  scraper/cleartrip.ts  stub (network-blocked source)
  store.ts          routes.json / prices.json persistence
  alerts.ts         Telegram sendMessage
  config.ts         env, city IDs, time windows
  runCheck.ts       manual check entrypoint
```
