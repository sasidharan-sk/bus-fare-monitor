import "dotenv/config";

export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
export const CHECK_INTERVAL_HOURS = Number(process.env.CHECK_INTERVAL_HOURS ?? 2);
export const PRICE_DROP_THRESHOLD = Number(process.env.PRICE_DROP_THRESHOLD ?? 50);
export const FAIL_ALERT_AFTER = Number(process.env.FAIL_ALERT_AFTER ?? 3);

export interface City {
  name: string;
  id: string;
}

const CITIES_RAW: Record<string, City> = {
  bangalore: { name: "Bangalore", id: "122" },
  bengaluru: { name: "Bangalore", id: "122" },
  blr: { name: "Bangalore", id: "122" },
  salem: { name: "Salem", id: "602" },
  erode: { name: "Erode", id: "236" },
};

export const CITY_NAMES = [...new Set(Object.values(CITIES_RAW).map((c) => c.name))].sort();

export function resolveCity(input: string): City | undefined {
  return CITIES_RAW[input.trim().toLowerCase()];
}

export const WINDOWS: Array<[string, string]> = [
  ["0-6", "12 AM - 6 AM"],
  ["6-12", "6 AM - 12 PM"],
  ["12-18", "12 PM - 6 PM"],
  ["18-24", "6 PM - 12 AM"],
];

export const WINDOW_LABELS: Record<string, string> = Object.fromEntries(WINDOWS);

export const ROUTES_FILE = "routes.json";
export const PRICES_FILE = "prices.json";
export const STATUS_FILE = "check-status.json";
