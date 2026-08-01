/* Verification harness for the Layout Section prototypes: loads each variant,
   captures console errors, and screenshots the full page. Run with the dev
   server up: node .scratch/layout-reader/shoot.mjs */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:3000/prototypes/layout-reader";
const OUT = new URL("./", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

let failures = 0;
for (let v = 1; v <= 4; v++) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto(`${BASE}?v=${v}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}variant-${v}.png` });
  const picker = await page.locator(".proto-picker").count();
  const stage = await page.locator(".lproto-main").count();
  console.log(
    `v${v}: picker=${picker} stage=${stage} consoleErrors=${errors.length}`
  );
  if (errors.length > 0) {
    failures += 1;
    for (const error of errors) console.log(`  ERROR: ${error}`);
  }
  page.removeAllListeners("console");
  page.removeAllListeners("pageerror");
}

// Interaction spot-checks on variant 4 (segmented viewport switch).
await page.goto(`${BASE}?v=4`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "sm", exact: true }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}variant-4-sm.png` });
const readout = await page.locator(".lproto-canvas-readout").textContent();
console.log(`canvas switch → ${readout?.trim()}`);

// Variant 3: hovering a rule row isolates its blueprint anchor.
await page.goto(`${BASE}?v=3`, { waitUntil: "networkidle" });
await page.locator(".lproto-row", { hasText: "grid.columns" }).first().hover();
await page.waitForTimeout(250);
const anchorActive = await page
  .locator('.lproto-bp-svg [data-anchor="3"][data-anchor-active]')
  .count();
await page.screenshot({ path: `${OUT}variant-3-hover.png` });
console.log(`blueprint hover anchor-3 active=${anchorActive}`);

// Variant 2: Concern ordering reorders the atlas cards.
await page.goto(`${BASE}?v=2`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Concern", exact: true }).click();
await page.waitForTimeout(300);
const firstCard = await page
  .locator(".lproto-atlas-role")
  .first()
  .textContent();
console.log(`atlas Concern order first=${firstCard}`);

// Keyboard contract: 2 switches to Atlas, R replays without switching.
await page.keyboard.press("2");
await page.waitForTimeout(300);
const active = await page
  .locator(".proto-picker-item[data-active]")
  .textContent();
const url = page.url();
console.log(`key "2" → active=${active} url=${url}`);

await browser.close();
console.log(failures === 0 ? "OK: no console errors" : "FAILURES present");
