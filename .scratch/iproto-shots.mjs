import { chromium } from "playwright";

const base = "http://127.0.0.1:3000/prototypes/interaction-reader";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(String(err)));

for (const [i, name] of [[1, "matrix"], [2, "timeline"], [3, "rig"]]) {
  await page.goto(`${base}?v=${i}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `.scratch/iproto-${name}.png` });
}

// Interaction probes on Rig: hover + press the button, open the sheet.
await page.goto(`${base}?v=3`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Save changes" }).hover();
await page.waitForTimeout(300);
await page.screenshot({ path: ".scratch/iproto-rig-hover.png" });
await page.getByRole("button", { name: "Open sheet" }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: ".scratch/iproto-rig-sheet.png" });

console.log("console errors:", errors.length ? errors : "none");
await browser.close();
