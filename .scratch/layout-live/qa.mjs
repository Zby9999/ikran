// 09C-B Layout Blueprint — live QA with the REAL Desktop project
// "ikran test 7" (4 candidate rules, rich prose metadata, no recognized
// spatial keys). Expected honest path: NO blueprint card (nothing drawable —
// no decorative scaffold), 4 unavailable cards, anchors still on rows.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const CDP = "http://127.0.0.1:63570";
const SHOTS = new URL("./shots/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const browser = await chromium.connectOverCDP(CDP);
const context = browser.contexts()[0];
const page = context.pages()[0];
page.setDefaultTimeout(15000);

const consoleProblems = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleProblems.push(msg.text());
});
page.on("pageerror", (err) => consoleProblems.push(String(err)));

// ---- Canvas → Design System Browser → Layout. ----
const tokenInput = page.getByRole("textbox", {
  name: "Figma Personal Access Token"
});
const selectTool = page.getByRole("button", { name: "Select (V)" });
await page.waitForFunction(() => document.body.innerText.length > 0, undefined, {
  timeout: 15000
});
if (await tokenInput.isVisible().catch(() => false)) {
  await tokenInput.fill("figd_ok_e2e");
  await page.getByRole("button", { name: "Check Figma token" }).click();
  await page.getByRole("button", { name: "Enter Canvas" }).click();
}
await selectTool.waitFor({ state: "visible" });
check("canvas entered (gate cleared)", true);

if ((await page.getByTestId("design-system-browser").count()) === 0) {
  await page.getByTestId("open-design-system-browser").click();
}
await page.getByRole("button", { name: "Layout", exact: true }).click();
const heading = page.getByRole("heading", { name: "Layout", exact: true });
await heading.waitFor({ state: "visible" });
check("standard Layout page heading", true);

// ---- Rows: 4 anchored candidate rules from the real project. ----
const anchorNums = await page.locator(".dsb-row-anchor > .dsb-anchor-num").count();
check("4 anchored rule rows", anchorNums === 4, `got ${anchorNums}`);
const chips = await page
  .locator(".dsb-row-anchor [data-testid='ds-status-chip']")
  .allInnerTexts();
check(
  "all rows candidate",
  chips.length === 4 && chips.every((t) => t.trim() === "candidate"),
  chips.join(", ")
);

// ---- Honest path: no blueprint card when nothing is drawable. ----
check(
  "no blueprint card (no decorative scaffold)",
  (await page.getByTestId("ds-layout-blueprint").count()) === 0
);
check(
  "no generic empty state either",
  (await page.getByTestId("ds-samples-empty").count()) === 0
);
const unavailableCards = page.locator(
  "[data-testid^='ds-layout-unavailable-']:not([data-testid*='-status-'])"
);
check(
  "4 honest unavailable cards",
  (await unavailableCards.count()) === 4,
  `got ${await unavailableCards.count()}`
);
const firstText = await unavailableCards.first().innerText();
check(
  "card explains why (no drawable spatial values)",
  firstText.includes("No visual sample")
);
check(
  "each card has Unavailable origin tag",
  (await page.locator(
    "[data-testid^='ds-layout-unavailable-']:not([data-testid*='-status-']) .dsb-origin[data-origin='unavailable']"
  ).count()) === 4
);
await page.screenshot({ path: `${SHOTS}10-desktop-layout-honest.png` });

// ---- Anchor wiring still live on rows even without a drawing. ----
await page.locator(".dsb-row-anchor").nth(1).hover();
await page.waitForTimeout(250);
check(
  "hover row → row marked active",
  (await page.locator(".dsb-row-anchor[data-anchor-active]").innerText()).includes(
    "layout.statsDualColumn"
  )
);
await page.screenshot({ path: `${SHOTS}11-desktop-hover-row-2.png` });
await heading.hover();
await page.waitForTimeout(250);
check(
  "leave row → mark cleared",
  (await page.locator(".dsb-row-anchor[data-anchor-active]").count()) === 0
);

// ---- Narrow viewport: stacked, no overflow. ----
const split = page.getByTestId("ds-leaf-split");
await page.setViewportSize({ width: 500, height: 800 });
await page.waitForTimeout(400);
check("narrow → stacked", (await split.getAttribute("data-stacked")) === "true");
const overflow = await split.evaluate((el) => el.scrollWidth - el.clientWidth);
check("narrow → no horizontal overflow", overflow <= 1, `overflow ${overflow}px`);
await page.screenshot({ path: `${SHOTS}12-desktop-narrow.png` });
await page.setViewportSize({ width: 1712, height: 950 });
await page.waitForTimeout(400);

// ---- Console clean. ----
check(
  "no console errors / pageerrors",
  consoleProblems.length === 0,
  consoleProblems.slice(0, 3).join(" | ")
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
