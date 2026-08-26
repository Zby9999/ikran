# 47 — Cached bounded-parallel component verification

**What to build:** Verify several registered components quickly without making the Runtime or project dev server unstable. Reuse unchanged results by deterministic digest, prioritize the component the designer is viewing, and run changed component/state documents with bounded concurrency instead of one global serial queue.

Blocked by: 46 — Default-first background verification.

Status: resolved

## Acceptance criteria

- [x] Verification identity covers the component code, Preview Registration/default and state recipes, provider recipe, relevant shared adapter, and dependency fingerprint.
- [x] An unchanged identity reuses its successful result without launching Chromium or reloading state documents; a changed identity invalidates only affected component/state results.
- [x] Verification uses a documented, configurable concurrency ceiling with a conservative default; queue order prioritizes the currently requested/viewed component and then stable registration order.
- [x] One slow, broken, or timed-out component does not prevent unrelated components from completing, and retrying it does not discard their results.
- [x] Timing reports cache hits, queue wait, browser work, per-component completion, and total batch duration.
- [x] In the standard warm fixture, ordinary components reach Verified Candidate within the agreed P95 target without increasing blank/fallback regressions.

## Real Agent validation

A real project registers at least three components with several states. Run verification twice unchanged, then modify one component. Evidence shows the second run is served from cache and the third re-verifies only the changed identity while other heroes remain available.

## Open gaps

- Cross-project shared caches and remote CI cache transport are outside this project-local slice.

## Comments

- 2026-08-27: Claimed. Expanding the verification identity to component source + recipe/provider + shared adapter/manifest + dependency manifests, then replacing the serial background loop with priority-ordered bounded work units and durable batch/work timings.
- 2026-08-27: Implementation complete. Verification identities cover component source, preview/default/state/provider recipe, the shared adapter contract, and dependency manifests without hashing unrelated sibling registry entries. Successful documents are cached by identity; priority-ordered work runs under configurable concurrency (default 2, max 8), with isolated results and durable batch/work cache, queue-wait, and browser timing.
- 2026-08-27: Resolved. Regression coverage proves adding/changing a sibling preserves unaffected cache entries; final warm P95 is 888 ms to visual and 919 ms to Verified Candidate.
