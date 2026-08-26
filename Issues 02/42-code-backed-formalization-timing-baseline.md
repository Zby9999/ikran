# 42 — Code-backed formalization timing baseline

**What to build:** Make the existing component-to-Design-System path explain its own latency. One completed run must report structured durations for conversation reconciliation, component code linking, harness preparation, artifact declaration, Preview readiness, live-hero declaration, default/state verification, and formalization, so later tickets can prove which waits they removed without changing the workflow itself.

Blocked by: None — can start immediately.

Status: resolved

## Acceptance criteria

- [x] One standard component can complete the current Active code-backed flow and produce a structured timing breakdown plus total wall-clock duration.
- [x] The timing record distinguishes Agent wait from Runtime work where that boundary is observable, cold from warm Preview startup, component and state counts, cache status, retry count, and typed failure stage.
- [x] Timing is attached to stable run/component identities and contains no session token, credential, transcript body, source code, or other secret-bearing payload.
- [x] Existing Runtime, MCP, Browser, verification, and formalization behaviour is unchanged; automated tests cover successful, failed, retried, and interrupted timing closure.
- [x] A baseline run records current Time to Visual, Time to Verified Candidate, and Time to Formalized for at least one real component.

## Real Agent validation

A real Agent completes the current code-backed flow without timing-specific prompts. Preserve the structured timing output and compare it with the designer-observed wall-clock duration; automated/mock timing is reported separately.

## Open gaps

- Long-term telemetry retention and cross-project analytics are outside this ticket; the first slice only needs durable, project-local evidence sufficient to compare Issues 43–50.

## Comments

- 2026-08-27: Claimed for implementation. The first slice records project-local operational timing outside canonical research events, with a public read seam for success, failure, retry, and interruption assertions.
- 2026-08-27: Runtime implementation complete: schema v38, eight-stage command instrumentation, sanitized project-local summaries, and `get_component_formalization_timing`. Automated evidence: 130 related tests plus TypeScript passed. Real Agent/browser timings are intentionally collected once in Issue 50 so automated and real evidence stay separate.
- 2026-08-27: Resolved under the consolidated Issue 50 gate. The Active artifact path now starts timing automatically and spans code linking, readiness, shared-adapter preparation, default geometry, background verification, and later formalization. Final real timings and suite evidence are recorded in `docs/validation/component-preview-real-2026-08-27.md`.
