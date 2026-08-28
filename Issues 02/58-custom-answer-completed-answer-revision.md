# 58 — Custom Answer Submission and Completed Answer Revision

Status: resolved

Blocked by: 57 — Variable Agent Choices and First Answer Selection.

## What to build

Complete the subject response model by adding the “Add your answer…” path and
making Complete Question Cards editable. A subject can answer without accepting
an Agent choice, or reopen a completed card and replace the current answer with
another choice or revised custom text.

Activating “Add your answer…” replaces its placeholder with an auto-growing
text input. Enter submits the answer directly; Shift+Enter inserts a line break.
A successful submission collapses the card. A failed submission keeps the card
open and preserves the subject's text so it can be retried.

Clicking a Complete card reopens the full choice list. If the current answer
came from an Agent choice, that choice is visibly identified. If it came from
custom input, the custom field reopens with the current answer prefilled. A new
choice click immediately replaces the answer and collapses the card again.

Runtime must receive explicit answer intent rather than infer provenance from
text equality. Agent-choice answers remain
`agent-proposed-designer-accepted`; custom answers are `designer-edited`, even
when custom text happens to equal one of the prepared choice labels.

## Acceptance criteria

- [x] Every Choice card includes one “Add your answer…” entry after the complete
      variable-length Agent choice list.
- [x] Activating custom entry produces an auto-growing input with no placeholder
      left in the submitted value.
- [x] Enter submits non-empty custom text, Shift+Enter inserts a newline, and
      blank or pending submissions are ignored.
- [x] A successful custom submission records the canonical final answer as
      `designer-edited` and collapses the card into Complete.
- [x] Answer submission uses an explicit choice-versus-custom intent contract;
      Runtime never derives provenance solely by comparing display strings.
- [x] Clicking a Complete card restores all choices and the custom-answer path
      without losing the current answer.
- [x] Reopened Agent-choice answers identify the selected choice; reopened
      custom answers prefill and expose the custom input.
- [x] Choosing a different Agent choice immediately submits and collapses;
      revising custom text submits with Enter and collapses.
- [x] Submission failure leaves the card open with the previous selection or
      custom draft intact and permits a retry.
- [x] Every successful revision advances the existing Alignment semantic
      revision, invalidates only dependent incremental planning decisions, and
      remains visible in the established research/export record.
- [x] Read-only cards expose neither an actionable choice nor an editable custom
      input, while retaining understandable answer content.
- [x] Component, Runtime, MCP, and staged-flow tests cover first custom answer,
      multiline input, exact-text provenance, choice-to-choice,
      choice-to-custom, custom-to-choice, failure recovery, read-only behavior,
      and repeated edits.

## Out of scope

- Final pixel-level Figma alignment and measured tldraw geometry are delivered
  by Ticket 59.
- No new answer-source authority tier is introduced.
- Preview/code-backed component behavior and workflow guidance remain unchanged.

## Comments

2026-08-28 — Resolved on `codex/question-card-answer-options`. The Workbench
now sends explicit `option` or `custom` intent, submits custom text with Enter,
preserves Shift+Enter newlines, and keeps failed drafts open. Complete cards can
be reopened and revised. Choosing “Add your answer…” after an Agent choice
starts with an empty field, while reopening an existing custom answer restores
its text. Successful collapse returns keyboard focus to the persistent card
header with `preventScroll`. Component, Runtime/MCP, staged-flow, full-check,
and real-browser paths passed.
