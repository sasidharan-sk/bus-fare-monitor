import { chromium } from "playwright";

const redbusUrl =
  "https://www.redbus.in/bus-tickets/bangalore-to-salem" +
  "?fromCityName=Bangalore&fromCityId=122&toCityName=Salem&toCityId=602" +
  "&onward=05-Oct-2026&srcCountry=IND&destCountry=IND&opId=0&busType=Any";

const cleartripUrl =
  "https://www.cleartrip.com/bus/results?fromCity=24659&toCity=8902" +
  "&journeyDate=2026-10-19&fromCityName=Erode&toCityName=Bangalore";

const browser = await chromium.launch({ headless: true, channel: "chrome" });

async function probe(name, url, probeFn) {
  const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36" });
  try {
    await page.goto(url, { timeout: 60_000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(9_000);
    const info = await page.evaluate(probeFn);
    console.log(`\n=== ${name} ===`);
    console.log(JSON.stringify(info, null, 2));
  } catch (exc) {
    console.log(`\n=== ${name} === FAILED: ${exc.message}`);
  } finally {
    await page.close();
  }
}

await probe("RedBus", redbusUrl, () => ({
  finalUrl: location.href,
  title: document.title,
  dateInput: document.querySelector("#onward_cal")?.value ?? null,
  fromInput: document.querySelector("#src")?.value ?? null,
  toInput: document.querySelector("#dest")?.value ?? null,
  buses: document.querySelectorAll(".bus-items").length,
  anyBusPrice: [...document.querySelectorAll("span")].some((s) => /₹\s?\d{3,}/.test(s.textContent ?? "")),
  bodySnippet: document.body.innerText.slice(0, 300).replace(/\s+/g, " "),
}));

await probe("ClearTrip", cleartripUrl, () => ({
  finalUrl: location.href,
  title: document.title,
  hasErode: document.body.innerText.includes("Erode"),
  hasBangalore: document.body.innerText.includes("Bangalore"),
  hasDate: /19 Oct|Oct 19|2026-10-19/.test(document.body.innerText),
  bodySnippet: document.body.innerText.slice(0, 300).replace(/\s+/g, " "),
}));

await browser.close();
