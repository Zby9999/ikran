import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:63307/prototypes/ds-section-nav";
const OUT = ".scratch/proto-shots";
mkdirSync(OUT, { recursive: true });

const consoleMsgs = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") consoleMsgs.push(`[${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => consoleMsgs.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: "networkidle" });

// Variant 1 — Split Row: initial (foundations home)
await page.screenshot({ path: `${OUT}/v1-split-row-home.png` });

// hover the Foundations header row to reveal the chevron, then collapse
const headerRow = page.locator(".group\\/hrow").first();
await headerRow.hover();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/v1-hover-header.png` });
await headerRow.getByLabel("Collapse Foundations").click();
await page.waitForTimeout(350);
await page.screenshot({ path: `${OUT}/v1-collapsed.png` });
await headerRow.getByLabel("Expand Foundations").click();
await page.waitForTimeout(350);

// navigate to Color leaf
await page.getByRole("button", { name: "Color", exact: true }).first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/v1-color-leaf.png` });

// Variant 2 — Overview Child via keyboard
await page.keyboard.press("2");
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/v2-overview-child.png` });
// collapse the Components folder
await page.getByRole("button", { name: /Components/ }).first().click();
await page.waitForTimeout(350);
await page.screenshot({ path: `${OUT}/v2-collapsed.png` });

// Variant 3 — Section Tabs
await page.keyboard.press("3");
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/v3-section-tabs.png` });
// switch to Components tab
await page.getByRole("tab", { name: "Components" }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/v3-components-tab.png` });

// keyboard: arrow back to variant 1, replay
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(200);
await page.keyboard.press("r");
await page.waitForTimeout(300);

// URL persistence check
const url = page.url();
console.log("URL after arrow-left from v3:", url);

// picker position sanity: picker should not overlap sidebar interactions (bottom-center is fine here)

console.log("console messages:", consoleMsgs.length ? consoleMsgs : "none");
await browser.close();
