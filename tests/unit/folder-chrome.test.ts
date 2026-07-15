import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { FolderChrome } from "../../components/workbench/folder-chrome";

describe("FolderChrome tool group", () => {
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
});
