import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  AgentAnnotationCard,
  ALIGNMENT_CARD_SEED_GAP_PX,
  AlignmentQuestionCard,
  activateAlignmentQuestionCard,
  alignmentSubmissionForCustomText,
  customAnswerDraftOnActivation,
  endAlignmentCardFocusPreview,
  hugAlignmentAnswerTextarea,
  previewAlignmentQuestionFocus,
  resolveAlignmentAnswerDisplay,
  restoreAlignmentQuestionHeaderFocus,
  shouldSubmitAlignmentCustomAnswer,
  stopAlignmentCardPointer,
  submitAlignmentQuestionAnswer,
  submitAlignmentQuestionOption
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
        { kind: "custom", text: "Use the editorial reference." },
        onSubmitAnswer,
        onSubmitted
      )
    ).resolves.toBe(true);

    expect(onSubmitAnswer).toHaveBeenCalledWith({
      kind: "custom",
      text: "Use the editorial reference."
    });
    expect(onSubmitted).toHaveBeenCalledWith({
      kind: "custom",
      text: "Use the editorial reference."
    });
  });

  test("keeps the editor open when answer persistence fails", async () => {
    const onSubmitted = vi.fn();

    await expect(
      submitAlignmentQuestionAnswer(
        { kind: "custom", text: "Keep editing." },
        vi.fn().mockResolvedValue({ ok: false, error: "save_failed" }),
        onSubmitted
      )
    ).resolves.toBe(false);

    expect(onSubmitted).not.toHaveBeenCalled();
  });

  test("submits a prepared choice by stable identity", async () => {
    const onSubmitAnswer = vi.fn().mockResolvedValue({ ok: true });
    const onSubmitted = vi.fn();
    const option = { id: "fluid", text: "Use a fluid inset token." };

    await expect(
      submitAlignmentQuestionOption(option, onSubmitAnswer, onSubmitted)
    ).resolves.toBe(true);

    expect(onSubmitAnswer).toHaveBeenCalledWith({
      kind: "option",
      optionId: "fluid"
    });
    expect(onSubmitted).toHaveBeenCalledWith(option);
  });

  test("uses Enter for custom submission and preserves Shift+Enter newlines", () => {
    expect(
      shouldSubmitAlignmentCustomAnswer({
        key: "Enter",
        shiftKey: false,
        isComposing: false
      })
    ).toBe(true);
    expect(
      shouldSubmitAlignmentCustomAnswer({
        key: "Enter",
        shiftKey: true,
        isComposing: false
      })
    ).toBe(false);
    expect(
      shouldSubmitAlignmentCustomAnswer({
        key: "Enter",
        shiftKey: false,
        isComposing: true
      })
    ).toBe(false);
    expect(
      shouldSubmitAlignmentCustomAnswer({
        key: "a",
        shiftKey: false,
        isComposing: false
      })
    ).toBe(false);
  });

  test("starts a blank custom draft after an Agent option was selected", () => {
    expect(
      customAnswerDraftOnActivation(
        "question-1:option:2",
        "Use the selected Agent option."
      )
    ).toBe("");

    expect(
      customAnswerDraftOnActivation(
        "",
        "Keep my previously submitted custom answer."
      )
    ).toBe("Keep my previously submitted custom answer.");
  });

  test("shows a successful local revision before the Runtime snapshot catches up", () => {
    expect(
      resolveAlignmentAnswerDisplay({
        savedAnswer: "First Agent choice",
        selectedOptionId: "option-1",
        submittedAnswer: "Second Agent choice",
        submittedOptionId: "option-2"
      })
    ).toEqual({ answer: "Second Agent choice", selectedOptionId: "option-2" });

    expect(
      resolveAlignmentAnswerDisplay({
        savedAnswer: "First Agent choice",
        selectedOptionId: "option-1",
        submittedAnswer: "My own answer",
        submittedOptionId: ""
      })
    ).toEqual({ answer: "My own answer", selectedOptionId: "" });

    expect(
      resolveAlignmentAnswerDisplay({
        savedAnswer: "My own answer",
        selectedOptionId: undefined,
        submittedAnswer: "First Agent choice",
        submittedOptionId: "option-1"
      })
    ).toEqual({ answer: "First Agent choice", selectedOptionId: "option-1" });
  });

  test("keeps legacy cards on the compatibility payload while modern cards use custom intent", () => {
    expect(alignmentSubmissionForCustomText([], "Keep the legacy proposal"))
      .toEqual({ kind: "legacy", text: "Keep the legacy proposal" });
    expect(alignmentSubmissionForCustomText([
      { id: "keep", text: "Keep it" },
      { id: "change", text: "Change it" }
    ], "Keep it")).toEqual({ kind: "custom", text: "Keep it" });
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

  test("grows the answer field to the content height instead of scrolling", () => {
    const textarea = {
      scrollHeight: 95,
      style: { height: "38px" }
    };

    hugAlignmentAnswerTextarea(
      textarea as Pick<HTMLTextAreaElement, "style" | "scrollHeight">
    );

    expect(textarea.style.height).toBe("95px");
  });

  test("restores focus to the collapsed question without scrolling the canvas", () => {
    const focus = vi.fn();

    restoreAlignmentQuestionHeaderFocus({ focus });

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
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
    ["design-concept", "#c97759", "#fff0ea", "#fffbfa", "#a88a7e"],
    ["visual-language", "#4178ba", "#e6f1ff", "#f9fcff", "#698db9"],
    ["token", "#be5fde", "#fbeeff", "#fefbff", "#ae6fc3"],
    ["layout", "#dc3a91", "#f8eff3", "#fdfbfc", "#b2688f"],
    ["component", "#3db0ac", "#e8fffe", "#faffff", "#5ba3a1"],
    ["interaction", "#b8c807", "#fcffdc", "#fefff7", "#949b44"]
  ] as const)(
    "uses the stage palette and raised surface for %s",
    (stage, accent, tint, raised, submit) => {
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
      expect(html).toContain(`--alignment-raised:${raised}`);
      expect(html).toContain(`--alignment-submit:${submit}`);
    }
  );

  test("renders a collapsed unanswered card without exposing answer source", () => {
    const html = renderToStaticMarkup(
      createElement(AlignmentQuestionCard, {
        ...question,
        expanded: false,
        answerOptions: [
          { id: "keep", text: "Keep the inset on desktop." },
          { id: "reduce", text: "Reduce the inset on compact screens." }
        ],
        answerSource: "agent-proposed-designer-accepted",
        onExpandedChange: vi.fn(),
        onSubmitAnswer: vi.fn()
      })
    );

    expect(html).toContain('data-status="unanswered"');
    expect(html).toContain('data-expanded="false"');
    expect(html).not.toContain("Checkout frame · node 44:120");
    expect(html).not.toContain(">5.</span>");
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
    expect(html).not.toContain("Keep the inset on desktop.");
    expect(html).not.toContain("Reduce the inset on compact screens.");
    expect(html).not.toContain("Add your answer");
    expect(html).not.toContain("textarea");
  });

  test("prefills a legacy expanded editor without restoring the removed send block", () => {
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
    expect(html).toContain('aria-label="Answer question 5"');
    expect(html).toContain(">Keep the inset on desktop.</textarea>");
    expect(html).not.toContain('aria-label="Submit answer 5"');
    expect(html).not.toContain("<svg");
  });

  test("opens every prepared choice followed by the custom-answer entry", () => {
    const html = renderToStaticMarkup(
      createElement(AlignmentQuestionCard, {
        ...question,
        expanded: true,
        answerOptions: [
          { id: "keep", text: "Keep the 20px inset." },
          { id: "reduce", text: "Use 12px on compact screens." },
          { id: "fluid", text: "Use a fluid inset token." }
        ],
        onExpandedChange: vi.fn(),
        onSubmitAnswer: vi.fn()
      })
    );

    expect(html).toContain('aria-label="Choose Keep the 20px inset."');
    expect(html).toContain('aria-label="Choose Use 12px on compact screens."');
    expect(html).toContain('aria-label="Choose Use a fluid inset token."');
    expect(html.indexOf("Keep the 20px inset.")).toBeLessThan(
      html.indexOf("Use 12px on compact screens.")
    );
    expect(html.indexOf("Use 12px on compact screens.")).toBeLessThan(
      html.indexOf("Use a fluid inset token.")
    );
    expect(html).toContain('aria-label="Add your answer"');
    expect(html.indexOf("Use a fluid inset token.")).toBeLessThan(
      html.indexOf('aria-label="Add your answer"')
    );
    expect(html).not.toContain("textarea");
  });

  test("keeps projected preparation questions understandable but non-actionable", () => {
    const html = renderToStaticMarkup(
      createElement(AlignmentQuestionCard, {
        ...question,
        expanded: true,
        readOnly: true,
        answerOptions: [
          { id: "keep", text: "Keep the inset on desktop." },
          { id: "change", text: "Change the inset." }
        ],
        onExpandedChange: vi.fn(),
        onSubmitAnswer: vi.fn()
      })
    );

    expect(html).toContain('data-read-only="true"');
    expect(html).toMatch(/aria-label="Open question 5 editor"[^>]*disabled=""/);
    expect(html).toMatch(/aria-label="Choose Keep the inset on desktop\."[^>]*disabled=""/);
    expect(html).toMatch(/aria-label="Add your answer"[^>]*disabled=""/);
    expect(html).toContain("aria-describedby=");
    expect(html).not.toContain("<textarea");
  });

  test("shows a final answer while keeping an answered card editable", () => {
    const answerOptions = [
      { id: "keep", text: "Keep the 20px inset." },
      { id: "reduce", text: "Use 12px on compact screens." }
    ];
    const collapsed = renderToStaticMarkup(
      createElement(AlignmentQuestionCard, {
        ...question,
        expanded: false,
        answerOptions,
        selectedOptionId: "keep",
        finalAnswer: "Keep the 20px inset.",
        answerSource: "agent-proposed-designer-accepted",
        onExpandedChange: vi.fn(),
        onSubmitAnswer: vi.fn()
      })
    );
    const expanded = renderToStaticMarkup(
      createElement(AlignmentQuestionCard, {
        ...question,
        expanded: true,
        answerOptions,
        selectedOptionId: "keep",
        finalAnswer: "Keep the 20px inset.",
        answerSource: "agent-proposed-designer-accepted",
        onExpandedChange: vi.fn(),
        onSubmitAnswer: vi.fn()
      })
    );

    expect(collapsed).toContain('data-status="answered"');
    expect(collapsed).toContain('data-slot="complete-answer"');
    expect(collapsed).toContain("Keep the 20px inset.");
    expect(collapsed).not.toContain("Use 12px on compact screens.");
    expect(expanded).toContain('aria-label="Choose Keep the 20px inset."');
    expect(expanded).toContain('data-selected="true"');
    expect(expanded).toContain("Use 12px on compact screens.");
    expect(expanded).not.toContain("textarea");
    expect(expanded).not.toContain("designer-edited");
  });

  test("reopens a completed custom answer as a prefilled growing textarea", () => {
    const html = renderToStaticMarkup(
      createElement(AlignmentQuestionCard, {
        ...question,
        expanded: true,
        answerOptions: [
          { id: "keep", text: "Keep the 20px inset." },
          { id: "reduce", text: "Use 12px on compact screens." }
        ],
        finalAnswer: "Use 20px until the compact breakpoint.",
        answerSource: "designer-edited",
        onExpandedChange: vi.fn(),
        onSubmitAnswer: vi.fn()
      })
    );

    expect(html).toContain('aria-label="Answer question 5"');
    expect(html).toContain(">Use 20px until the compact breakpoint.</textarea>");
    expect(html).not.toContain('placeholder="Add your answer..."');
    expect(html).toContain('data-custom-active="true"');
  });

  test("locks the Figma card geometry into the isolated stylesheet", () => {
    const css = readFileSync(
      new URL("../../components/workbench/alignment-ui.module.css", import.meta.url),
      "utf8"
    );

    expect(css).toMatch(/\.questionCard\s*{[^}]*width:\s*360px/s);
    expect(css).toMatch(/\.questionCard\s*{[^}]*padding:\s*6px/s);
    expect(css).toMatch(/\.questionCard\s*{[^}]*border-radius:\s*14px/s);
    expect(css).not.toMatch(/\.questionCard\[data-expanded="true"\]\s*{[^}]*width:/s);
    expect(css).toMatch(/\.questionHeader\s*{[^}]*gap:\s*4px/s);
    expect(css).toMatch(/\.questionNumber\s*{[^}]*width:\s*32px/s);
    expect(css).toMatch(/\.questionNumber\s*{[^}]*height:\s*32px/s);
    expect(css).toMatch(/\.questionNumber\s*{[^}]*border-radius:\s*8px/s);
    expect(css).toMatch(
      /\.questionNumber\s*{[^}]*background:\s*var\(--alignment-raised\)/s
    );
    expect(css).toMatch(
      /\.questionCopy\s*{[^}]*background:\s*var\(--alignment-raised\)/s
    );
    expect(css).toMatch(/\.answerChoices\s*{[^}]*gap:\s*4px/s);
    expect(css).toMatch(/\.answerChoice\s*,\s*\.customAnswerTrigger\s*{[^}]*min-height:\s*32px/s);
    expect(css).toMatch(/\.finalAnswer\s*{[^}]*white-space:\s*pre-wrap/s);
    expect(css).toMatch(
      /\.finalAnswer\s*{[^}]*background:\s*var\(--alignment-raised\)/s
    );
    expect(css).toMatch(
      /\.answerChoice\s*,\s*\.customAnswerTrigger\s*{[^}]*background:\s*var\(--alignment-raised\)/s
    );
    expect(css).toMatch(
      /\.answerChoice\s*,\s*\.customAnswerTrigger\s*{[^}]*background-color 120ms ease,[^}]*transform 120ms var\(--motion-ease-out\)/s
    );
    expect(css).toMatch(
      /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.answerChoice:hover:not\(:disabled\),[\s\S]*?\.customAnswerTrigger:hover:not\(:disabled\)[\s\S]*?var\(--alignment-accent\) 8%/s
    );
    expect(css).toMatch(
      /\.answerChoice:active:not\(:disabled\),\s*\.customAnswerTrigger:active:not\(:disabled\)\s*{[^}]*transform:\s*scale\(0\.97\)/s
    );
    expect(css).toMatch(
      /\.customAnswerEditor\s*{[^}]*background:\s*var\(--alignment-raised\)/s
    );
    expect(css).not.toMatch(/\.answerEditor\s*{/s);
    expect(css).not.toMatch(/\.answerSubmit\s*{/s);
    expect(css).toMatch(/\.questionNumber\s*{[^}]*font-weight:\s*400/s);
    expect(css).toMatch(/\.questionObservation\s*{[^}]*font-weight:\s*400/s);
    expect(css).toMatch(/\.annotationHeading\s*{[^}]*font-weight:\s*400/s);
    expect(css).toMatch(/\.annotationCard\s*{[^}]*border:\s*1px solid #6e6e6e/s);
    expect(css).toMatch(/\.annotationCard\[data-editing="true"\]\s*{[^}]*width:\s*360px/s);
    expect(css).toMatch(/\.annotationEditor\s*{[^}]*min-height:\s*70px/s);
    expect(css).toMatch(/\.annotationEditor\s*{[^}]*padding:\s*16px 16px 16px 20px/s);
    expect(css).toMatch(/\.annotationEditor\s*{[^}]*align-items:\s*flex-end/s);
    expect(css).not.toMatch(/\.annotationEditor\s*{[^}]*(?<!min-)height:\s*56px/s);
    expect(css).toMatch(/\.annotationEditor textarea\s*{[^}]*min-height:\s*38px/s);
    expect(css).toMatch(/\.annotationEditor textarea\s*{[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.annotationSubmit\s*{[^}]*align-self:\s*flex-end/s);
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
