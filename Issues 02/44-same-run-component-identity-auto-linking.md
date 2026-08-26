# 44 — Same-run component identity auto-linking

**What to build:** When a component is created or updated inside the current Prototype run, let its normal source-artifact declaration carry the exact Design System entry, module, export, default arguments, state arguments, and optional provider recipe. Runtime uses that provenance to link code and live preview atomically, removing the separate backfill-and-declare sequence for the standard path.

Blocked by: 43 — Storybook-free instant code-backed preview.

Status: resolved

## Acceptance criteria

- [x] One accepted same-run component declaration is sufficient to establish its code links and Preview Registration without a later `backfill_component_code_links` or `declare_component_live_heroes` call.
- [x] Runtime accepts automatic linking only when the run, Design System entry, declared source artifact, module, and export identities are exact and project-local.
- [x] Runtime never guesses a component identity from a filename or display name. Legacy or ambiguous components fail closed into the future exception path without changing source files or DB rows.
- [x] Source JSON, DB projection, content digests, approval-grade provenance where required, canonical events, and derived view remain transactionally consistent; a failed write restores the original state.
- [x] Repeating an identical declaration is idempotent, while changing the preview recipe invalidates only that component's registration and verification identity.
- [x] The success result makes the next automatic action explicit and does not instruct the Agent to run the retired manual chain.

## Real Agent validation

A real Agent implements and declares one new component in a Prototype run. Event history proves that the component becomes code-backed without separate backfill/live-hero declaration tool calls, and the Browser renders the correct export.

## Open gaps

- Bulk onboarding of unrelated legacy components is not an auto-match problem; uncertain mappings remain Agent decisions under Issue 49.

## Comments

- 2026-08-27: Claimed. The normal `record_artifact_written` declaration will carry an exact `componentPreview` recipe; module identity must equal the declared artifact path, and Runtime will fail closed before touching the component spec when run/entry/surface/export identity is invalid.
- 2026-08-27: Implementation complete. `record_artifact_written.componentPreview` now validates exact run/surface/entry/module/export identity, auto-backfills codeLinks, writes the shared Preview Registration/liveHero, returns `background_verification`, and reports identical declarations idempotently. Provider recipes fail closed for the exception boundary. 57 related tests and typecheck pass; final real event-lineage validation remains in Issue 50.
- 2026-08-27: Resolved after fail-closed preflight was moved ahead of artifact/spec mutation, stable component entry rows replaced delete/reinsert ingest, and regression coverage proved wrong exports change neither source artifacts, specs, events, nor registrations.
