# 50 — Real-Agent performance gate and Active-path cutover

**What to build:** Prove the Storybook-free fast path on real components, then make it the only advertised Active component-to-Design-System workflow. The release gate covers a simple component, a multi-state component, and a component with non-trivial providers or fixtures; it verifies latency, correctness, fallback honesty, Agent exception routing, and formalization safety before retiring the old per-component harness/backfill/declaration instructions.

Blocked by: 47 — Cached bounded-parallel component verification; 49 — Agent semantic-delta exception boundary.

Status: resolved

## Acceptance criteria

- [x] A project without Storybook completes real tests for a Text Link-level component, a Sticky Navigation-level multi-state component, and a component requiring a provider or fixture recipe.
- [x] Warm Time to Visual is P95 at or below 3 seconds for standard components, and warm Time to Verified Candidate is P95 at or below 60 seconds for the agreed ordinary-component fixture; cold startup is reported separately.
- [x] The standard path requires no per-component Story, bespoke harness route, manual code-link backfill, separate live-hero declaration, or Agent-driven verification loop.
- [x] The complex case reaches the bounded Agent exception path, while no-delta components complete mechanically without waking the Agent.
- [x] State failure preserves a valid default code-backed hero, true live failure uses the existing honest fallback, and neither path introduces intermediate status UI or a blank frame.
- [x] Active MCP instructions, tool descriptions, next actions, product docs, and real-Agent setup describe only the new workflow. Historical records and readable legacy data remain compatible, but retired screenshot/per-component authoring routes are not advertised.
- [x] Full typecheck, unit, integration, Browser, Runtime/MCP parity, production build, and relevant real-Agent smoke pass with automated/mock and real evidence reported separately.

## Real Agent validation

This ticket is the consolidated real-Agent acceptance. Preserve timing output, relevant semantic events, verification summaries, Browser evidence for live/default/fallback behaviour, and the exact Agent exception packet/disposition without recording credentials, session tokens, or private transcript content.

## Open gaps

- Storybook CSF ingestion remains a future optional adapter and is not required for completion.
- Cross-project performance analytics and CI-scale distributed verification remain future work.

## Comments

- 2026-08-29: Follow-up real-chain validation separated Runtime speed from Agent/host delay. The Active result now routes the Agent to declare remaining components and return for visible Prototype review; `verify_registered_component_previews` is diagnostic-only and must not be polled after ordinary declarations. One run timing session now merges every later component/state identity instead of remaining pinned to the first component.
- 2026-08-27: Claimed. Cutting Active MCP instructions/tool next-actions to ordinary `record_artifact_written.componentPreview` + automatic Runtime work; legacy tools remain readable/callable but will be labeled compatibility-only. Final validation uses real Chromium for simple, multi-state/failure, cache/invalidation, and provider-exception cases with timing evidence separated from mocks.
- 2026-08-27: Resolved. Isolated Next 16/React 19 production + real Chromium gate passed without Storybook: cold 5,923/5,960 ms; warm 10-sample P95 888/919 ms for Time to Visual/Verified Candidate. Text Link and Sticky Navigation rendered exact geometry, the broken non-default state preserved the valid default hero, and Provider Card produced one digest-pinned `retain_open_gap` exception. Final automated gates: typecheck, 1366 unit tests, 84/84 serial E2E, and production build; detailed evidence is in `docs/validation/component-preview-real-2026-08-27.md`.
