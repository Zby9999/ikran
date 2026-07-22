import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { FolderChrome } from "../../components/workbench/folder-chrome";

describe("FolderChrome tool group", () => {
  test("renders completed/current and completed/overall extraction counts", () => {
    const html = renderToStaticMarkup(createElement(FolderChrome, {
      folderName: "Folder Name",
      phase: "extraction",
      extraction: {
        stageCompleted: 3,
        stageTotal: 5,
        overallCompleted: 7,
        overallTotal: 9
      },
      onBack: vi.fn()
    }));

    expect(html).toMatch(/extraction-stage-progress[^>]*>3\/5</);
    expect(html).toMatch(/extraction-overall-progress[^>]*>7\/9</);
  });

  test("renders the Figma select tool with the shared active-button state", () => {
    const html = renderToStaticMarkup(createElement(FolderChrome, {
      folderName: "Folder Name",
      phase: "sign-seed",
      onBack: vi.fn(),
      onSelect: vi.fn(),
      selectActive: true
    }));

    expect(html).toContain('data-testid="select-button"');
    expect(html).toContain('aria-label="Select (V)"');
    expect(html).toContain('data-active="true"');
    expect(html).toContain('aria-pressed="true"');
  });

  test("can retarget the existing Back affordance without adding UI", () => {
    const html = renderToStaticMarkup(createElement(FolderChrome, {
      folderName: "Folder Name",
      phase: "extraction",
      backLabel: "Back to Seed Reference",
      onBack: vi.fn()
    }));

    expect(html).toContain('aria-label="Back to Seed Reference"');
    expect(html).not.toContain("Back to Seed Reference</");
  });
});
