# 49 — Agent semantic-delta exception boundary

**What to build:** Reduce Agent involvement to the cases that require design judgment. Runtime produces one bounded exception packet when a component introduces a possible reusable rule, conflicts with current Design System semantics, lacks evidence, needs an uncertain provider/fixture, or cannot be mapped exactly. The Agent returns a structured disposition; deterministic writes and existing designer-approval gates remain Runtime-owned.

Blocked by: 48 — Automatic Verified Candidate orchestration.

Status: resolved

## Acceptance criteria

- [x] Runtime emits no Agent task for a proven no-delta Verified Candidate and emits exactly one resumable exception packet for a component that needs judgment.
- [x] The packet contains the bounded component/run identity, current component contract, structured implementation/verification delta, exact evidence and provenance, detected conflicts, permitted target categories, and unresolved questions; it excludes unrelated conversation and project history.
- [x] The Agent disposition distinguishes no reusable impact, update an existing rule, create a Candidate, retain an Open Gap, and unresolved conflict, with explicit targets and supporting evidence IDs.
- [x] Runtime validates identities, target ownership, evidence membership, current digests, and authorization. It does not use string matching or an LLM to decide whether natural-language evidence semantically supports a rule.
- [x] Reusable-rule changes continue through the existing designer review/approval boundary; the Agent cannot silently formalize a new rule or promote an entry.
- [x] Legacy component mapping and non-standard provider recipes use this exception boundary instead of filename guessing or bespoke hidden recovery paths.

## Real Agent validation

Run three real cases: no semantic impact, one reusable component-rule change, and one ambiguous provider/evidence conflict. Only the latter two wake the Agent; the resulting Candidate/Gap/proposal and designer-approval lineage match the Agent's explicit disposition.

## Open gaps

- Automatic natural-language rule inference remains explicitly out of scope; improving Agent judgment quality requires separate evaluation data rather than weakening this boundary.

## Comments

- 2026-08-27: Claimed. Provider/fixture uncertainty and explicit semantic/evidence ambiguity will create one digest-pinned bounded packet instead of partially linking. Agent dispositions will be schema-validated against packet identities/evidence and route reusable changes back through the existing designer review boundary.
- 2026-08-27: Implementation complete. Schema v43 stores one deduplicated bounded packet for provider/semantic uncertainty. `resolve_component_preview_exception` validates digest, permitted disposition, evidence membership, target category and target ownership requirements, then records one structured event; reusable changes return to existing Rule Update Review and never auto-formalize. Standard no-delta verification produces no exception. 115 related tests and typecheck pass.
- 2026-08-27: Resolved after review added current-identity digest validation, transactional pending-state compare-and-set, idempotent repeat resolution, concrete target existence/ownership checks, and an honest `redeclaration_required` action for no-impact dispositions. `semanticImpact` is now the explicit Agent judgment; Runtime verifies the contract digest and routes missing/possible/provider/state conflicts into one packet.
