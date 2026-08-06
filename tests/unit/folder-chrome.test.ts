import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { FolderChrome } from "../../components/workbench/folder-chrome";

describe("FolderChrome tool group", () => {
  test("renders per-question Extraction progress bars from segments", () => {
    const html = renderToStaticMarkup(
      createElement(FolderChrome, {
        folderName: "Folder Name",
        phase: "extraction",
        extraction: {
          segments: [
            {
              id: "q1",
              stageId: "design-principle",
              color: "#e78460",
              answered: true
            },
            {
              id: "q2",
              stageId: "design-principle",
              color: "#e78460",
              answered: false
            },
            {
              id: "q3",
              stageId: "interaction",
              color: "#c1d03c",
              answered: true
            }
          ]
        },
        onBack: vi.fn()
      })
    );

    expect(html).toContain('data-testid="extraction-progress-track"');
    expect(html).toContain(
      'aria-label="Extraction progress: 2 of 3 questions answered"'
    );
    expect(html).toContain('seed-workbench__folder-extraction-group');
    expect(html).toContain('data-answered="true"');
    expect(html).toContain('data-answered="false"');
    expect(html).toContain('data-stage="design-principle"');
    expect(html).toContain('data-stage="interaction"');
    expect(html).not.toContain("extraction-stage-progress");
    expect(html).not.toContain("extraction-overall-progress");
  });

  test("renders the Figma select tool with the shared active-button state", () => {
    const html = renderToStaticMarkup(
      createElement(FolderChrome, {
        folderName: "Folder Name",
        phase: "sign-seed",
        onBack: vi.fn(),
        onSelect: vi.fn(),
        selectActive: true
      })
    );

    expect(html).toContain('data-testid="select-button"');
    expect(html).toContain('aria-label="Select (V)"');
    expect(html).toContain('data-active="true"');
    expect(html).toContain('aria-pressed="true"');
  });

  test("can retarget the existing Back affordance without adding UI", () => {
    const html = renderToStaticMarkup(
      createElement(FolderChrome, {
        folderName: "Folder Name",
        phase: "extraction",
        extraction: { segments: [] },
        backLabel: "Back to Seed Reference",
        onBack: vi.fn()
      })
    );

    expect(html).toContain('aria-label="Back to Seed Reference"');
  });
});

// Issue 30 — the panel body follows the Runtime project phase once the draft
// design system is confirmed (Figma 729:1465 and 735:1555).
describe("FolderChrome prototype and build phases", () => {
  test("prototype phase shows the pill and the waiting status", () => {
    const html = renderToStaticMarkup(
      createElement(FolderChrome, {
        folderName: "Folder Name",
        phase: "prototype",
        onBack: vi.fn()
      })
    );

    expect(html).toContain('data-testid="seed-workbench-prototype"');
    expect(html).toContain("Prototype");
    expect(html).toContain("waiting for confirmation");
    // The header tool group stays available through the prototype wait.
    expect(html).toContain('data-testid="annotate-button"');
    // Draft Design System stays a sibling below the panel, not inside it.
    expect(html).not.toContain('data-testid="folder-design-system-button"');
    expect(html).not.toContain('data-testid="folder-page-list"');
  });

  test("build phase shows Design System, the page list, and the Build pill", () => {
    const html = renderToStaticMarkup(
      createElement(FolderChrome, {
        folderName: "Folder Name",
        phase: "build",
        pages: [
          { id: "seed-1", label: "Seed Page", kind: "figma" },
          { id: "proto-1", label: "Page 1", kind: "website" }
        ],
        selectedPageId: "proto-1",
        onSelectPage: vi.fn(),
        onOpenDesignSystem: vi.fn(),
        onBack: vi.fn()
      })
    );

    expect(html).toContain('data-testid="folder-design-system-button"');
    expect(html).toContain("Design System");
    expect(html).toContain('data-testid="folder-page-list"');
    expect(html).toContain('data-page-id="seed-1"');
    expect(html).toContain('data-page-kind="figma"');
    expect(html).toContain('data-page-kind="website"');
    expect(html).toContain("Seed Page");
    // Only the selected row carries the white background.
    expect(
      html.match(/seed-workbench__folder-page--selected/g)
    ).toHaveLength(1);
    expect(html).toContain('aria-current="true"');
    expect(html).toContain(">Build<");
    expect(html).not.toContain('data-testid="seed-workbench-prototype"');
  });

  test("build phase renders without pages before any page exists", () => {
    const html = renderToStaticMarkup(
      createElement(FolderChrome, {
        folderName: "Folder Name",
        phase: "build",
        onBack: vi.fn()
      })
    );

    expect(html).toContain('data-testid="folder-design-system-button"');
    expect(html).not.toContain('data-testid="folder-page-list"');
    expect(html).toContain(">Build<");
  });
});
