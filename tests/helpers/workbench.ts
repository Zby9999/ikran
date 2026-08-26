// Shared Workbench entry for Playwright specs: clears the Figma token gate
// (e2e runs with the mock credential store / mock Figma API) when it appears,
// then confirms the canvas toolbar is up. Idempotent — when the gate was
// already cleared (e.g. after a Runtime restart) it returns as soon as the
// canvas is visible.

import { expect } from "../fixtures";

export async function enterCanvas(
  page: import("@playwright/test").Page
): Promise<void> {
  const tokenInput = page.getByRole("textbox", {
    name: "Figma Personal Access Token"
  });
  const selectTool = page.getByRole("button", { name: "Select (V)" });
  const workbench = page.getByTestId("seed-workbench");
  await expect(workbench).toHaveAttribute("data-runtime-status", "ready");
  const gate = await workbench.getAttribute("data-figma-gate");
  if (gate === "closed") {
    await expect(tokenInput).toBeVisible();
    await tokenInput.fill("figd_ok_e2e");
    await page.getByRole("button", { name: "Check Figma token" }).click();
    await page.getByRole("button", { name: "Enter Canvas" }).click();
  }
  await expect(page.getByTestId("figma-verification-panel")).toHaveCount(0);
  await expect(selectTool).toBeVisible();
}
