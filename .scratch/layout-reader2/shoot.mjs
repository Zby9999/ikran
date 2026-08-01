/* Verification harness for the Layout reader prototype round 2:
   loads each variant, captures console errors, screenshots the full page,
   and probes the headline interactions (Cadence scroll-spy, Inspector
   hover/pin probe, Stories row cross-highlight). Run with dev server up:
   node .scratch/layout-reader2/shoot.mjs */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:3000/prototypes/layout-reader";
const OUT = new URL("./", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

let failures = 0;
for (let v = 1; v <= 3; v++) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto(`${BASE}?v=${v}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}variant-${v}.png` });
  const picker = await page.locator(".proto-picker").count();
  const stage = await page.locator(".lproto-main").count();
  console.log(`v${v}: picker=${picker} stage=${stage} consoleErrors=${errors.length}`);
  if (errors.length > 0) {
    failures += 1;
    for (const error of errors) console.log(`  ERROR: ${error}`);
  }
  page.removeAllListeners("console");
  page.removeAllListeners("pageerror");
}

// --- Cadence: scroll the stage, expect the spy to reach the baseline zone ---
await page.goto(`${BASE}?v=1`, { waitUntil: "networkidle" });
await page.locator(".lc-rule").nth(4).click(); // jump to section.heroToNext
await page.waitForTimeout(900);
const rhythmZone = await page.locator(".lc-stage").getAttribute("data-zone");
await page.locator(".lc-stage").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
await page.waitForTimeout(900);
const endZone = await page.locator(".lc-stage").getAttribute("data-zone");
console.log(`cadence spy: after rule5 click=${rhythmZone} after full scroll=${endZone}`);
await page.screenshot({ path: `${OUT}cadence-scrolled.png` });

// --- Inspector: hover grid gap legend row, expect probe; click to pin ---
await page.goto(`${BASE}?v=2`, { waitUntil: "networkidle" });
await page.locator(".li-legend-row").nth(3).hover();
await page.waitForTimeout(400);
const probeVisible = await page.locator(".li-probe").count();
const hot = await page.locator(".li-shell").getAttribute("data-hot");
await page.screenshot({ path: `${OUT}inspector-hover.png` });
await page.locator(".li-legend-row").nth(3).click();
await page.waitForTimeout(300);
const pinned = (await page.locator(".li-probe[data-pinned]").count()) === 1;
console.log(`inspector: probe=${probeVisible} hot=${hot} pinned=${pinned}`);

// --- Stories: hover grid.gap row, expect frames to heat ---
await page.goto(`${BASE}?v=3`, { waitUntil: "networkidle" });
await page.locator(".ls-table tbody tr").nth(3).hover();
await page.waitForTimeout(300);
const frameHot = await page.locator(".ls-frame").first().getAttribute("data-hot");
await page.screenshot({ path: `${OUT}stories-row-hover.png` });
console.log(`stories: frameHot=${frameHot}`);

await browser.close();
if (failures > 0) process.exit(1);
