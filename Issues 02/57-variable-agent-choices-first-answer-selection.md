# 57 — Variable Agent Choices and First Answer Selection

Status: resolved

Blocked by: None — can start immediately.

## What to build

Replace the singular prefilled-answer assumption with Question Cards that carry
a stable, variable-length set of Agent-prepared answer choices. A new Question
Card has at least two choices and may have more whenever the question reasonably
benefits from them; the product must not impose an arbitrary fixed choice count.

The complete path must run from the Alignment Agent contract through durable
Runtime records and the Workbench. An unanswered card first shows only its
header and question. Opening it reveals every prepared choice. Clicking any
choice is an explicit submission, immediately records the choice as the final
answer, and collapses the card into its Complete state.

Every Agent-prepared choice has stable identity. Runtime validates submitted
choice identity against the owning card and derives the canonical final answer
and answer provenance rather than trusting client-supplied display text. Any
Agent-prepared choice is recorded as `agent-proposed-designer-accepted`.

Existing records built around the legacy singular proposed answer remain
readable and answerable during the transition. The implementation must not
fabricate additional choices for those records or reinterpret an unanswered
legacy record as answered.

## Acceptance criteria

- [x] The Alignment Agent contract instructs the Agent to prepare at least two
      concise, meaningful, mutually distinguishable choices and permits more
      choices when they improve the question; it does not generate an “Other”
      choice because the Workbench owns custom-answer entry.
- [x] New Question Cards persist an ordered choice list with stable per-card
      identities, and Runtime snapshots, MCP reads, and successful research
      export preserve that order and identity.
- [x] Finalizing newly prepared questions rejects missing, duplicate, empty, or
      fewer-than-two choices without reintroducing a required singular
      prefilled answer.
- [x] The Workbench projects any valid number of choices without truncating the
      list or assuming exactly two.
- [x] An unanswered card follows the Default-to-Choice interaction: it initially
      shows only the question, and opening it reveals all Agent choices.
- [x] Clicking a choice submits by stable identity, disables duplicate
      submission while pending, and collapses to a Complete card showing the
      canonical answer after success.
- [x] Runtime rejects a choice identity that does not belong to the card and
      records every valid Agent-choice submission as
      `agent-proposed-designer-accepted`.
- [x] A choice submission continues to advance the existing Alignment semantic
      revision and section-delta chain exactly once.
- [x] Legacy singular-proposal and no-proposal records remain readable and do
      not gain fabricated choices or accidental final answers.
- [x] Unit and Runtime/MCP vertical tests cover variable choice counts, invalid
      choice payloads, first-choice and later-choice submission, provenance,
      semantic revision, export, and legacy compatibility.

## Out of scope

- Custom-answer entry and completed-answer revision are delivered by Ticket 58.
- Final visual polish, measured canvas geometry, and browser conformance are
  delivered by Ticket 59.
- Preview/code-backed component behavior, Designer Annotation styling, and
  workflow guidance are unchanged.

## Comments

2026-08-28 — Resolved on `codex/question-card-answer-options` (base
`da0d768`). New Runtime/MCP creation requires at least two ordered, unique,
non-empty choices and assigns stable card-scoped option IDs. Choice submissions
are canonicalized by Runtime, exported with identity, and advance the existing
semantic revision exactly once. Persisted pre-choice rows remain readable and
answerable through the legacy compatibility path; the new create path cannot
produce another legacy row. Covered by the full repository gate (135 unit
files / 1422 tests and 86 Playwright tests) plus the production build.
