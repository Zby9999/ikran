    // ---- Layout leaf (09C-D02): Source Capture placards, one per rule. ----
    await page.getByRole("button", { name: "Layout", exact: true }).click();
    // Layout is a full-width page now — no split panes, no empty samples.
    await expect(page.getByTestId("ds-leaf-split")).toHaveCount(0);
    await expect(page.getByTestId("ds-samples-empty")).toHaveCount(0);
    const placards = page.getByTestId("ds-layout-placards");
    await expect(placards).toBeVisible();

    const gridPlacard = page.getByTestId("ds-layout-placard-grid-page");
    await expect(gridPlacard).toBeVisible();
    await expect(gridPlacard).toContainText("Default page grid");
    await expect(
      gridPlacard.getByTestId("ds-layout-status-grid-page")
    ).toHaveText("candidate");
    // Recognized facts read as one quiet line — never raw JSON.
    const gridFacts = gridPlacard.locator(".dsb-placard-facts");
    await expect(gridFacts).toContainText("1120px");
    await expect(gridFacts).toContainText("→ spacing.200");
    await expect(gridPlacard).not.toContainText('{"columns"');
    // The capture image renders and actually loads through /api/artifacts.
    const gridImg = gridPlacard.locator(".dsb-placard-figure img");
    await expect(gridImg).toHaveAttribute(
      "alt",
      "Source capture of Landing / Grid"
    );
    await expect
      .poll(() =>
        gridImg.evaluate((el) => (el as HTMLImageElement).naturalWidth)
      )
      .toBeGreaterThan(0);
    // The height cap keeps any capture from breaking the reading rhythm.
    const gridImgBox = await gridImg.boundingBox();
    expect(gridImgBox).not.toBeNull();
    expect(gridImgBox!.height).toBeLessThanOrEqual(341);
    // Provenance caption: origin tag, node name, formatted capture time.
    await expect(
      gridPlacard.locator('.dsb-origin[data-origin="source-capture"]')
    ).toBeVisible();
    await expect(gridPlacard).toContainText("Landing / Grid");
    await expect(gridPlacard).toContainText("captured 2026-07-30 14:05");
    await expect(gridPlacard).not.toContainText("stale");

    // A capture whose surface vanished reads stale.
    const shellPlacard = page.getByTestId("ds-layout-placard-shell-regions");
    await expect(shellPlacard).toContainText("Page shell vertical stack");
    await expect(shellPlacard).toContainText("Landing / Shell");
    await expect(shellPlacard.locator("[data-stale]")).toContainText("· stale");

    // Rules with no linked node get the honest unavailable block.
    const navPlacard = page.getByTestId("ds-layout-placard-nav-mobile");
    await expect(navPlacard).toContainText("Mobile navigation layout");
    await expect(
      navPlacard.getByTestId("ds-layout-unavailable-nav-mobile")
    ).toBeVisible();
    await expect(navPlacard).toContainText("No source capture");
    await expect(
      navPlacard.locator('.dsb-origin[data-origin="unavailable"]')
    ).toBeVisible();
    await expect(
      navPlacard.getByTestId("ds-layout-status-nav-mobile")
    ).toHaveText("open gap");

    // View in frame opens the full-frame lightbox; Esc closes it without
    // closing the sheet (capture-phase Esc handling).
    await gridPlacard.getByRole("button", { name: "View in frame" }).click();
    const lightbox = page.locator(".dsb-lightbox");
    await expect(lightbox).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(lightbox).toHaveCount(0);
    await expect(sheet).toHaveAttribute("data-open", "true");

    // ---- Split divider (09C-A): exercised on the Color leaf, which keeps
    // the reading/samples split. ----
    await page.getByRole("button", { name: "Color", exact: true }).click();
    const split = page.getByTestId("ds-leaf-split");
    await expect(split).toBeVisible();
    await expect(split).not.toHaveAttribute("data-stacked", "true");

