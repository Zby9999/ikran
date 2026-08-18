import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  AgentAnnotationCard,
  ALIGNMENT_CARD_SEED_GAP_PX,
  AlignmentQuestionCard,
  activateAlignmentQuestionCard,
  endAlignmentCardFocusPreview,
  previewAlignmentQuestionFocus,
  stopAlignmentCardPointer,
  submitAlignmentQuestionAnswer
} from "../../components/workbench/alignment-cards";

const question = {
  number: 5,
  stage: "layout" as const,
  observation: "Font issue",
  question: "Should every page preserve the 20px inset?",
  evidenceAnchor: "Checkout frame · node 44:120"
};

describe("AlignmentQuestionCard", () => {
  test("returns to the collapsed answered state after a successful submit", async () => {
    const onSubmitAnswer = vi.fn().mockResolvedValue({ ok: true });
    const onSubmitted = vi.fn();

    await expect(
      submitAlignmentQuestionAnswer(
        "Use the editorial reference.",
        onSubmitAnswer,
        onSubmitted
      )
    ).resolves.toBe(true);

    expect(onSubmitAnswer).toHaveBeenCalledWith(
      "Use the editorial reference."
    );
    expect(onSubmitted).toHaveBeenCalledWith(
      "Use the editorial reference."
    );
  });

  test("keeps the editor open when answer persistence fails", async () => {
    const onSubmitted = vi.fn();

    await expect(
      submitAlignmentQuestionAnswer(
        "Keep editing.",
        vi.fn().mockResolvedValue({ ok: false, error: "save_failed" }),
        onSubmitted
      )
    ).resolves.toBe(false);

    expect(onSubmitted).not.toHaveBeenCalled();
  });

  test("isolates pointer gestures from the tldraw canvas", () => {
    const stopPropagation = vi.fn();
    const markHandled = vi.fn();

    stopAlignmentCardPointer({ stopPropagation }, markHandled);

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(markHandled).toHaveBeenCalledOnce();
  });

  test("opens the editor and runs the card-specific activation together", () => {
    const onExpandedChange = vi.fn();
    const onActivate = vi.fn();

    activateAlignmentQuestionCard(onExpandedChange, onActivate);

    expect(onExpandedChange).toHaveBeenCalledWith(true);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  test("hover previews focus mode without opening the answer editor", () => {
    const onExpandedChange = vi.fn();
    const onFocusPreview = vi.fn();

    previewAlignmentQuestionFocus(onFocusPreview);

    expect(onFocusPreview).toHaveBeenCalledOnce();
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  test("mouse leave exits hover focus but preserves activated focus", () => {
    const onFocusPreviewEnd = vi.fn();

    endAlignmentCardFocusPreview(false, onFocusPreviewEnd);
    expect(onFocusPreviewEnd).toHaveBeenCalledOnce();

    endAlignmentCardFocusPreview(true, onFocusPreviewEnd);
    expect(onFocusPreviewEnd).toHaveBeenCalledOnce();
  });

  test("publishes the Figma card-to-seed spacing for canvas wiring", () => {
    expect(ALIGNMENT_CARD_SEED_GAP_PX).toBe(20);
  });

  test.each([
    ["design-concept", "#c97759", "#fff0ea", "#a88a7e"],
    ["visual-language", "#4178ba", "#e6f1ff", "#698db9"],
    ["token", "#be5fde", "#fbeeff", "#ae6fc3"],
    ["layout", "#dc3a91", "#f8eff3", "#b2688f"],
    ["component", "#3db0ac", "#e8fffe", "#5ba3a1"],
    ["interaction", "#b8c807", "#fcffdc", "#949b44"]
  ] as const)(
    "uses the exact Figma palette for %s",
    (stage, accent, tint, submit) => {
      const html = renderToStaticMarkup(
        createElement(AlignmentQuestionCard, {
          ...question,
          stage,
          expanded: true,
          onExpandedChange: vi.fn(),
          onSubmitAnswer: vi.fn()
        })
      );

      expect(html).toContain(`--alignment-accent:${accent}`);
      expect(html).toContain(`--alignment-tint:${tint}`);
      expect(html).toContain(`--alignment-submit:${submit}`);
    }
  );

  test("renders a collapsed unanswered card without exposing answer source", () => {
    const html = renderToStaticMarkup(
      createElement(AlignmentQuestionCard, {
        ...question,
        expanded: false,
        proposedAnswer: "Keep the inset on desktop.",
        answerSource: "agent-proposed-designer-accepted",
        onExpandedChange: vi.fn(),
        onSubmitAnswer: vi.fn()
      })
    );

    expect(html).toContain('data-status="unanswered"');
    expect(html).toContain('data-expanded="false"');
    expect(html).not.toContain("Checkout frame · node 44:120");
    expect(html).toContain("5.");
    expect(html.match(/Font issue/g)).toHaveLength(1);
    expect(html).toContain('data-slot="question-copy"');
    expect(html.indexOf("Font issue")).toBeGreaterThan(
      html.indexOf('data-slot="question-copy"')
    );
    expect(html.indexOf(question.question)).toBeGreaterThan(
      html.indexOf("Font issue")
    );
    expect(html).not.toContain("Agent observation");
    expect(html).toContain(question.question);
    expect(html).not.toContain("agent-proposed-designer-accepted");
    expect(html).not.toContain("Answer source");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-open="false"');
    expect(html).toContain("inert");
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("textarea");
  });

  test("prefills the expanded editor from the proposed answer", () => {
    const html = renderToStaticMarkup(
      createElement(AlignmentQuestionCard, {
        ...question,
        expanded: true,
        proposedAnswer: "Keep the inset on desktop.",
        onExpandedChange: vi.fn(),
        onSubmitAnswer: vi.fn()
      })
    );

    expect(html).toContain('data-expanded="true"');
    expect(html).toContain('aria-hidden="false"');
    expect(html).toContain('data-open="true"');
    expect(html).toContain('aria-label="Answer question 5"');
    expect(html).toContain(">Keep the inset on desktop.</textarea>");
    expect(html).toContain("<svg");
    expect(html).not.toContain(">↑<");
  });

  test("keeps projected preparation questions visible but read-only", () => {
    const html = renderToStaticMarkup(
      createElement(AlignmentQuestionCard, {
        ...question,
        expanded: true,
        readOnly: true,
        proposedAnswer: "Keep the inset on desktop.",
        onExpandedChange: vi.fn(),
        onSubmitAnswer: vi.fn()
      })
    );

    expect(html).toContain('data-read-only="true"');
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
    expect(html).toMatch(/aria-label="Submit answer 5"[^>]*disabled=""/);
  });

  test("shows a final answer while keeping an answered card editable", () => {
    const collapsed = renderToStaticMarkup(
      createElement(AlignmentQuestionCard, {
        ...question,
        expanded: false,
        finalAnswer: "Use 20px until the compact breakpoint.",
        answerSource: "designer-edited",
        onExpandedChange: vi.fn(),
        onSubmitAnswer: vi.fn()
      })
    );
    const expanded = renderToStaticMarkup(
      createElement(AlignmentQuestionCard, {
        ...question,
        expanded: true,
        finalAnswer: "Use 20px until the compact breakpoint.",
        answerSource: "designer-edited",
        onExpandedChange: vi.fn(),
        onSubmitAnswer: vi.fn()
      })
    );

    expect(collapsed).toContain('data-status="answered"');
    expect(collapsed).toContain("Use 20px until the compact breakpoint.");
    expect(expanded).toContain("textarea");
    expect(expanded).not.toContain("designer-edited");
  });

  test("locks the Figma card geometry into the isolated stylesheet", () => {
    const css = readFileSync(
      new URL("../../components/workbench/alignment-ui.module.css", import.meta.url),
      "utf8"
    );

    expect(css).toMatch(/\.questionCard\s*{[^}]*width:\s*320px/s);
    expect(css).toMatch(/\.questionCard\[data-expanded="true"\]\s*{[^}]*width:\s*360px/s);
    expect(css).toMatch(/\.answerEditor\s*{[^}]*height:\s*56px/s);
    expect(css).toMatch(/\.questionNumber\s*{[^}]*font-weight:\s*400/s);
    expect(css).toMatch(/\.questionObservation\s*{[^}]*font-weight:\s*400/s);
    expect(css).toMatch(/\.annotationHeading\s*{[^}]*font-weight:\s*400/s);
    expect(css).toMatch(/\.annotationCard\s*{[^}]*border:\s*1px solid #6e6e6e/s);
    expect(css).toMatch(/\.annotationCard\[data-editing="true"\]\s*{[^}]*width:\s*360px/s);
    expect(css).toMatch(/\.annotationEditor\s*{[^}]*height:\s*56px/s);
  });
});

describe("AgentAnnotationCard", () => {
  test("renders the neutral Figma annotation hierarchy", () => {
    const html = renderToStaticMarkup(
      createElement(AgentAnnotationCard, {
        number: 4,
        title: "Root Layout",
        body: "The root layout is a 1280px desktop canvas.",
        additionalInformation: ["Keep the 20px outer inset."],
        evidenceAnchor: "Figma node",
        editing: false,
        onEditingChange: vi.fn(),
        onAppendInformation: vi.fn()
      })
    );

    expect(html).toContain('data-kind="agent-annotation"');
    expect(html).toContain("4. Root Layout");
    expect(html).not.toContain("Figma node");
    expect(html).toContain("The root layout is a 1280px desktop canvas.");
    expect(html).toContain("Keep the 20px outer inset.");
  });

  test("edits by appending information without replacing the Agent-authored body", () => {
    const html = renderToStaticMarkup(
      createElement(AgentAnnotationCard, {
        number: 4,
        title: "Root Layout",
        body: "The root layout is a 1280px desktop canvas.",
        additionalInformation: [],
        evidenceAnchor: "Figma node",
        editing: true,
        onEditingChange: vi.fn(),
        onAppendInformation: vi.fn()
      })
    );

    expect(html).toContain("The root layout is a 1280px desktop canvas.");
    expect(html).toContain('aria-label="Add information to agent annotation"');
    expect(html).toContain('placeholder="Add your design intent..."');
    expect(html).toContain('aria-label="Submit agent annotation information"');
    expect(html).toContain("<textarea");
    expect(html).toContain("></textarea>");
    expect(html).toContain("<svg");
    expect(html).not.toContain(">Cancel<");
    expect(html).not.toContain(">Add information<");
    expect(html).not.toContain("required");
  });
});
