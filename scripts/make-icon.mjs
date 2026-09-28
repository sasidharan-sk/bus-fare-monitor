import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1d4ed8"/>
      <stop offset="1" stop-color="#0ea5e9"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#bae6fd"/>
      <stop offset="1" stop-color="#38bdf8"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <circle cx="256" cy="240" r="196" fill="#ffffff" opacity="0.08"/>
  <g>
    <rect x="152" y="374" width="52" height="30" rx="10" fill="#0f172a"/>
    <rect x="308" y="374" width="52" height="30" rx="10" fill="#0f172a"/>
    <rect x="136" y="110" width="240" height="278" rx="42" fill="#f8fafc"/>
    <rect x="136" y="110" width="240" height="278" rx="42" fill="none" stroke="#cbd5e1" stroke-width="6"/>
    <rect x="166" y="142" width="180" height="104" rx="20" fill="url(#glass)"/>
    <rect x="250" y="142" width="12" height="104" fill="#f8fafc"/>
    <rect x="166" y="258" width="180" height="10" rx="5" fill="#e2e8f0"/>
    <circle cx="188" cy="304" r="20" fill="#f59e0b"/>
    <circle cx="324" cy="304" r="20" fill="#f59e0b"/>
    <rect x="196" y="344" width="120" height="16" rx="8" fill="#cbd5e1"/>
  </g>
  <g>
    <circle cx="384" cy="380" r="70" fill="#16a34a"/>
    <circle cx="384" cy="380" r="70" fill="none" stroke="#f8fafc" stroke-width="10"/>
    <path d="M384 340 V404 M352 376 L384 410 L416 376"
          stroke="#ffffff" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </g>
</svg>`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`<body style="margin:0">${svg}</body>`);
await page.locator("svg").screenshot({ path: "assets/bot-icon.png" });
await browser.close();
console.log("wrote assets/bot-icon.png");
