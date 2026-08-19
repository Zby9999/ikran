import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { FolderChrome } from "../../components/workbench/folder-chrome";

describe("FolderChrome tool group", () => {
  test("renders the Figma select/annotate switch with the shared active state", () => {
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
    expect(html).toContain('data-testid="annotate-button"');
    expect(html).toContain('aria-label="Annotate on Figma (F)"');
    expect(html.match(/data-slot="tooltip-trigger"/g)).toHaveLength(2);
    expect(html).not.toContain('data-testid="follow-agent-button"');
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

describe("FolderChrome Sign Seed", () => {
  test("shows Set up squares, Complete, and the paste hint", () => {
    const html = renderToStaticMarkup(
      createElement(FolderChrome, {
        folderName: "Folder Name",
        phase: "sign-seed",
        seedCount: 0,
        onBack: vi.fn()
      })
    );

    expect(html).toContain('data-testid="seed-workbench-sign-seed"');
    expect(html).toContain("Sign Seed Design");
    expect(html).toContain("Set up");
    expect(html).toContain(">Complete<");
    expect(html).toContain('data-testid="sign-seed-next-phase"');
    expect(html).toMatch(/data-testid="sign-seed-next-phase"[^>]*disabled/);
    expect(html).toContain("Paste a Figma reference");
    expect(html).toContain('data-testid="folder-hint"');
    expect(html).toContain("seed-workbench__folder-hint");
    expect(html).not.toContain('data-testid="sign-seed-count"');
    expect(html.match(/data-testid="folder-setup-square"/g)).toHaveLength(3);
    expect(html).toContain('data-state="current"');
    expect(html).toContain('data-state="pending"');
  });

  test("enables Complete once a seed exists", () => {
    const html = renderToStaticMarkup(
      createElement(FolderChrome, {
        folderName: "Folder Name",
        phase: "sign-seed",
        seedCount: 1,
        onBack: vi.fn(),
        onNextPhase: vi.fn()
      })
    );

    expect(html).not.toMatch(/data-testid="sign-seed-next-phase"[^>]*disabled/);
    expect(html).toContain("Add a design language description");
    expect(html).not.toContain("Paste a Figma reference");
  });
});

describe("FolderChrome Extraction", () => {
  test("shows Extracting while the Agent is still preparing questions and keeps Complete unactive", () => {
    const html = renderToStaticMarkup(
      createElement(FolderChrome, {
        folderName: "Folder Name",
        phase: "extraction",
        completeEnabled: false,
        extraction: { segments: [] },
        onBack: vi.fn()
      })
    );

    expect(html).toContain('data-testid="seed-workbench-extraction"');
    expect(html).toContain("Extraction");
    expect(html).toContain("Extracting");
    expect(html).not.toContain("Answer the questions");
    expect(html).toContain('aria-label="Complete alignment"');
    expect(html).toMatch(/aria-label="Complete alignment"[^>]*disabled/);
    expect(html).not.toContain('data-testid="extraction-progress-track"');
    expect(html).toContain('data-state="done"');
    expect(html).toContain('data-state="current"');
  });

  test("shows Answer the questions once the six-part questions are ready and keeps Complete unactive", () => {
    const html = renderToStaticMarkup(
      createElement(FolderChrome, {
        folderName: "Folder Name",
        phase: "extraction",
        questionsReady: true,
        completeEnabled: false,
        extraction: {
          segments: [
            {
              id: "q1",
              stageId: "design-concept",
              color: "#e78460",
              answered: true
            }
          ]
        },
        onBack: vi.fn()
      })
    );

    expect(html).toContain("Answer the questions");
    expect(html).not.toContain("Extracting");
    expect(html).toMatch(/aria-label="Complete alignment"[^>]*disabled/);
  });

  test("turns the Extraction square green after Complete and says the Agent is creating the Draft Design System", () => {
    const html = renderToStaticMarkup(
      createElement(FolderChrome, {
        folderName: "Folder Name",
        phase: "extraction",
        completed: true,
        designSystemPreparing: true,
        completeEnabled: true,
        onBack: vi.fn()
      })
    );

    expect(html).toContain("Creating Draft Design System");
    expect(html).not.toContain("Ask the Agent to continue");
    expect(html).toContain("Waiting for Agent");
    expect(html).not.toContain(">Complete<");
    expect(html).toMatch(/aria-label="Waiting for Agent"[^>]*disabled/);
    expect(html.match(/data-state="done"/g)).toHaveLength(2);
    expect(html).not.toContain("Extracting");
    expect(html).not.toContain("Answer the questions");
  });

  test("tells the designer to iterate with the Agent or go next after the Draft Design System is written", () => {
    const html = renderToStaticMarkup(
      createElement(FolderChrome, {
        folderName: "Folder Name",
        phase: "extraction",
        completed: true,
        designSystemPreparing: false,
        completeEnabled: true,
        onBack: vi.fn()
      })
    );

    expect(html).toContain("Iterate with Agent, or go next");
    expect(html).toContain("Waiting for Agent");
    expect(html).not.toContain(">Complete<");
    expect(html).not.toContain("Creating Draft Design System");
    expect(html).not.toContain("Ask the Agent to continue");
    expect(html).not.toContain("Check to iterate");
  });

  test("enables Complete when Runtime coverage allows it", () => {
    const html = renderToStaticMarkup(
      createElement(FolderChrome, {
        folderName: "Folder Name",
        phase: "extraction",
        completeEnabled: true,
        onBack: vi.fn(),
        onComplete: vi.fn()
      })
    );

    expect(html).not.toMatch(/aria-label="Complete alignment"[^>]*disabled/);
  });
});

describe("FolderChrome prototype and build phases", () => {
  test("prototype phase shows Draft Design System and Complete inside the panel", () => {
    const html = renderToStaticMarkup(
      createElement(FolderChrome, {
        folderName: "Folder Name",
        phase: "prototype",
        onBack: vi.fn(),
        onOpenDesignSystem: vi.fn(),
        onConfirmPrototype: vi.fn()
      })
    );

    expect(html).toContain('data-testid="seed-workbench-prototype"');
    expect(html).toContain("Prototype");
    expect(html).toContain("Draft Design System");
    expect(html).toContain('data-testid="folder-draft-design-system-button"');
    expect(html).toContain('data-testid="folder-prototype-complete"');
    expect(html).toContain("Review and iterate the prototype");
    expect(html).not.toContain("Making a prototype");
    expect(html).not.toContain("waiting for confirmation");
    expect(html).not.toContain('data-testid="folder-design-system-button"');
    expect(html).not.toContain('data-testid="folder-page-list"');
    expect(html.match(/data-state="done"/g)).toHaveLength(2);
    expect(html).toContain('data-state="current"');
    expect(html).not.toMatch(/data-testid="folder-prototype-complete"[^>]*disabled/);
  });

  test("shows Making a prototype and keeps Complete unactive while no preview is ready", () => {
    const html = renderToStaticMarkup(
      createElement(FolderChrome, {
        folderName: "Folder Name",
        phase: "prototype",
        prototypePreparing: true,
        onBack: vi.fn(),
        onOpenDesignSystem: vi.fn(),
        onConfirmPrototype: vi.fn()
      })
    );

    expect(html).toContain("Making a prototype");
    expect(html).not.toContain("Ask the Agent to continue");
    expect(html).not.toContain("Review and iterate the prototype");
    expect(html).toMatch(/data-testid="folder-prototype-complete"[^>]*disabled/);
  });

  test("build phase shows Design System, the page list, and the Build label", () => {
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
    expect(
      html.match(/seed-workbench__folder-page--selected/g)
    ).toHaveLength(1);
    expect(html).toContain('aria-current="true"');
    expect(html).toContain(">Build<");
    expect(html).not.toContain("Set up");
    expect(html).not.toContain('data-testid="folder-hint"');
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
    expect(html).not.toContain('data-testid="folder-hint"');
  });
});
