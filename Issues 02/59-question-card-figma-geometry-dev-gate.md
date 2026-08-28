# 59 — Question Card Figma Geometry and Dev Integration Gate

Status: resolved

Blocked by: 57 — Variable Agent Choices and First Answer Selection; 58 — Custom Answer Submission and Completed Answer Revision.

## What to build

Finish the Question Card change by matching the approved Figma Default, Choice,
and Complete states and proving that variable choices and growing answers remain
correct inside the real Workbench canvas and the active development Alignment
chain.

Design reference: https://www.figma.com/design/FSgnAj1yrNlgDCt4V4wTfa/recursive-design-agent?node-id=1010-1212

Approved frames are Default `1010:1201`, Choice `999:1122`, and Complete
`1009:1150`. Explicitly ignore `1011:1223`, the superseded variant containing
an extra red block.

Question Cards use the approved 360-pixel width in every state, with separate
number and title tiles, the revised card radius and spacing, full-width choice
rows, and the custom-answer treatment. Every reasonable Agent choice remains
visible: the card grows with its list rather than introducing an internal
scroll area. Custom input and Complete answer rows grow to show their full
content.

The visible height must become real canvas geometry. Card placement, collision
avoidance, connector centers, focus behavior, and neighboring annotation lanes
must use the measured Question Card height so long or numerous choices cannot
overlap other cards. This Question Card-specific sizing must not change the
existing width or visual treatment of Designer Annotation cards.

Run the feature through the current development validation chain, including
legacy records, answer edits, Alignment semantic revisions, incremental
planning invalidation, research export, and real-browser visual verification.
The result must remain isolated from Preview/code-backed component work.

## Acceptance criteria

- [x] Default, Choice, and Complete Question Card states match the approved
      Figma structure, dimensions, spacing, typography, colors, borders, and
      corner treatment at normal browser zoom.
- [x] Question Cards remain 360 pixels wide in every state without changing
      Designer Annotation collapsed or expanded widths.
- [x] Cards render all prepared choices in order with no arbitrary count cap,
      truncation, or internal option-list scrolling.
- [x] Long choices, multiline custom drafts, and multiline final answers grow to
      expose their full content.
- [x] Measured Question Card height updates the canvas shape and participates in
      lane placement, collision avoidance, connector centering, and subsequent
      Runtime projection updates.
- [x] Opening, submitting, collapsing, reopening, and reselecting do not cause
      card overlap, incorrect edge anchoring, lost focus, nested interactive
      controls, or accidental layout animation.
- [x] Keyboard focus, screen-reader naming, pending state, read-only state, and
      reduced-motion behavior remain usable without inventing an unrelated
      visual system.
- [x] Legacy singular-proposal and no-proposal records coexist with new
      variable-choice records in one Runtime snapshot and remain answerable.
- [x] New choice and custom-answer revisions appear once in the semantic delta,
      trigger only the established dependent incremental-planning behavior, and
      preserve canonical research export semantics.
- [x] Focused component, projection, Runtime, MCP, and staged end-to-end tests
      pass before the full repository check is run.
- [x] A real-browser pass compares all three states, multiple choice counts,
      long content, completed-card reopening, and both answer modes against the
      approved Figma reference.
- [x] No production plugin is published, and no Preview/code-backed component,
      workflow, or Designer Annotation visual behavior is changed.

## Validation evidence

Record the tested development revision, focused-test results, full-check result,
real-browser scenarios, and any remaining visual variance in the ticket's
Comments section before resolving it.

## Comments

2026-08-28 — Resolved on `codex/question-card-answer-options` (base
`da0d768`). Implemented the approved Default `1010:1201`, Choice `999:1122`,
and Complete `1009:1150` structures; superseded red-block frame `1011:1223`
was explicitly excluded.

Validation evidence:

- Focused component/projection/Runtime/MCP/staged suites passed; independent
  specification and standards reviews reported no remaining actionable issue.
- `npm run check` passed: 135 unit files / 1422 tests and 86 Playwright tests.
- `npm run build` passed and wrote the schema-45 Runtime stamp.
- The real Workbench at the development fixture was sampled across card switch,
  reopen, choice/custom modes, and a five-line custom draft. The first sampled
  frame already had final height; Question 2 stayed at top `387`, Question 3 at
  `581.5`, and all ten subsequent samples were identical. The multiline card
  grew from `175.7` to `232.2` without moving its top edge.
- Height-delta sync preserves only the changed card's top edge; following cards
  return to canonical collision slots on shrink, preventing both visible jumps
  and cumulative downward drift. Annotation lanes keep their reserved spacing.
- No remaining variance was observed against the three approved frames at
  normal browser zoom. No plugin was published and the red block was not used.
