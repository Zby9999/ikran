import { chromium } from "playwright";

const WORKBENCH =
  "http://127.0.0.1:59011/?session=66dff93ea544baa2d5f1580ac50f54beb127b467816cb1aa6353618c36e23052&view=workbench";

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(WORKBENCH, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.getByTestId("folder-design-system-button").click();
await page.getByTestId("ds-sheet").waitFor({ timeout: 15000 });
await page.getByRole("tab", { name: "Components" }).click();
await page.waitForTimeout(400);
await page.locator(".dsb-navrow-label", { hasText: "Identity Header" }).click();
await page.locator('[data-testid="ds-component-title"]').waitFor({ timeout: 10000 });
await page.waitForTimeout(2000);

const btn = page.locator(".dsb-hero-state--live", { hasText: "default" }).first();
const box = await btn.boundingBox();
const snapshots = [];
const snap = async (label) => {
  const data = await page.evaluate(() => {
    const live = document.querySelector('[data-testid="ds-component-live"]');
    const row = document.querySelector('[data-testid="ds-component-states"]');
    const fallback = document.querySelector('[data-testid="ds-component-live-fallback"]');
    const b = row?.querySelector(".dsb-hero-state--live");
    return {
      src: live?.getAttribute("src"),
      visibility: live ? getComputedStyle(live).visibility : null,
      liveH: live ? Math.round(live.getBoundingClientRect().height) : null,
      stageH: document.querySelector('[data-testid="ds-component-live-stage"]')
        ? Math.round(document.querySelector('[data-testid="ds-component-live-stage"]').getBoundingClientRect().height)
        : null,
      rowBox: row ? row.getBoundingClientRect().toJSON() : null,
      btnBox: b ? b.getBoundingClientRect().toJSON() : null,
      fallback: fallback?.getAttribute("data-reason") ?? null
    };
  });
  snapshots.push({ label, ...data });
};

await snap("before");
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await snap("mouse-on-btn");
await page.waitForTimeout(200);
await snap("after-debounce-200");
await page.waitForTimeout(400);
await snap("after-600");
await page.waitForTimeout(1500);
await snap("after-2100");
await page.waitForTimeout(4000);
await snap("after-6100");

console.log(JSON.stringify({ initialBtn: box, snapshots }, null, 2));
await browser.close();
