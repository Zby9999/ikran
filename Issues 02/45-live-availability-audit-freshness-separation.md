# 45 — Live availability and audit freshness separation

**What to build:** Keep a reachable code-backed component visible while its code, preview recipe, or verification evidence is changing. Live availability must describe whether the current component can render; verification and evidence freshness must independently describe whether that rendering is eligible for formalization. A source edit must no longer remove an otherwise working live hero merely because its prior verification became stale.

Blocked by: 43 — Storybook-free instant code-backed preview.

Status: resolved

## Acceptance criteria

- [x] Editing a registered component while its Runtime-owned dev server remains reachable updates or reloads the live hero through the existing preview environment instead of immediately demoting it to source capture.
- [x] The internal model represents live availability separately from verification/evidence freshness; stale verification prevents formalization but does not by itself make the iframe unavailable.
- [x] A changed component automatically receives a new verification identity and is queued for background verification without an Agent refresh command.
- [x] A stopped server, invalid route, invalid geometry, or exhausted load attempt still follows the existing honest source-capture/unavailable fallback and never leaves a blank frame.
- [x] No new intermediate-state UI is introduced; the designer sees the live component whenever it is actually renderable.
- [x] Automated tests cover code change, preview reload, stale verification, true unavailability, recovery, and multiple open Browser clients.

## Real Agent validation

A real Agent changes the visual implementation of a currently visible component. The designer observes the updated code-backed hero without a manual `record_preview`/live declaration loop, while Runtime records that the new revision still requires verification.

## Open gaps

- A dependency-manifest change may still require a cold Preview restart; it is measured separately and must not be represented as an ordinary HMR refresh.

## Comments

- 2026-08-27: Claimed. Registered component source edits will keep a ready Preview surface live, invalidate only matching verification identities, and queue background re-verification; Browser projection will use live availability rather than audit freshness to choose the iframe.
- 2026-08-27: Implementation complete. Registered source edits now preserve ready surface availability, compute a new per-registration verification identity, queue only the affected registration, and invalidate every Browser client through the existing record bus. The Browser hero plan ignores audit staleness when live availability is true, but still falls back for stopped/failed surfaces and recovers when ready. 123 related tests and typecheck pass.
- 2026-08-27: Resolved after review tightened availability: `registered` is not live, default geometry is the only transition to `available`, old identity work uses compare-and-set, and unrelated modules on a shared registered surface no longer mark the surface stale.
