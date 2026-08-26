# 46 — Default-first background verification

**What to build:** Make first visibility depend only on a successful default live document and valid component geometry, then verify the component's declared states in the background. State verification results remain internal: they govern Verified Candidate and Formalized eligibility but do not add Browser status UI or remove a working default component.

Blocked by: 44 — Same-run component identity auto-linking; 45 — Live availability and audit freshness separation.

Status: resolved

## Acceptance criteria

- [x] The default document is attempted first and becomes visible immediately after a valid current geometry report, without waiting for the remaining state matrix.
- [x] Remaining declared states verify automatically in the background using the same sandbox, URL, origin, href, and geometry acceptance rules as the Browser.
- [x] A failed non-default state records a typed per-state result, leaves the successful default hero visible, and blocks Verified Candidate/Formalized eligibility until repaired.
- [x] A failed default document follows the existing source-capture/unavailable fallback and cannot be represented as a successful code-backed component.
- [x] Verification can be interrupted and resumed without losing successful results for the unchanged registration identity.
- [x] Issue 42 reports separate Time to Visual and Time to Verified Candidate for the same component run.

## Real Agent validation

A real Agent registers a Sticky Navigation-level component with multiple states, including one intentionally broken state. The designer sees the correct default component promptly; Runtime names the failing state and refuses verification eligibility until the Agent repairs it.

## Open gaps

- This ticket establishes ordering and eligibility, not multi-component throughput; caching, prioritization, and bounded parallelism belong to Issue 47.

## Comments

- 2026-08-27: Claimed. The verifier will persist default and per-state outcomes under one verification identity, return after default geometry, and schedule only unfinished non-default states. A non-default failure will affect eligibility only, never the live default hero.
- 2026-08-27: Implementation complete. Schema v40 stores per-identity/per-state outcomes. `verify_registered_component_previews` returns after default geometry, schedules unfinished states, preserves the default on non-default failure, resumes passed states after interruption, and gates formalization until every state is verified. 154 related tests and typecheck pass.
- 2026-08-27: Resolved with real Sticky Navigation evidence: default and expanded passed, the intentional broken state persisted `failed/http_error`, and returning to default rendered `139.109375 × 43.5` while the hero remained live and formalization stayed blocked.
