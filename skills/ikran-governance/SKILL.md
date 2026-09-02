---
name: ikran-governance
description: Govern Ikran design-system Rules during Rule Update and design-system maintenance. Use when deciding whether an observation deserves a reusable Rule, or whether existing Rules should be kept, revised, merged, or retired.
---

# Ikran Governance

A design system is a **compression layer**, not an archive. It preserves the
smallest coherent set of decisions that future surfaces need.

A good Rule is a durable, reusable constraint that changes future design
decisions. A description of what one page happened to look like remains
evidence until it earns broader scope.

## A Rule earns its place

Treat a Rule as design-system guidance only when every condition passes:

- **Transferable** — it applies beyond the source page to a named class of
  surfaces, components, states, or situations.
- **Decision-shaping** — it changes a choice a future designer or Agent would
  otherwise have to make again.
- **Grounded** — its evidence establishes both the decision and its intended
  scope. Explicit designer intent may establish scope directly; repeated
  validated use may establish it through practice.
- **Bounded** — its trigger, domain, and meaningful exceptions are clear.
- **Distinct** — the nearest existing Rules do not already express or subsume
  the same decision.
- **Actionable** — an Agent can apply it and a reviewer can recognize whether
  the result follows it.
- **Owned** — it lives in the artifact that is authoritative for the decision.

Complete the assessment only after every condition has a pass or a specific
unresolved reason. An unresolved condition keeps the item local, candidate, or
open rather than formal.

## Evidence establishes scope

Use the strongest available evidence:

1. Explicit designer intent that names the decision and its reusable scope.
2. The same validated decision across distinct surfaces or contexts.
3. A stable component, token, or implementation contract that intentionally
   carries the decision.
4. A single surface observation, which supports local behavior or a candidate
   until broader intent is established.

Conflicting evidence marks an open question about the Rule; it does not widen
the Rule by averaging the sources.

Examples demonstrate a Rule inside one context. Their incidental content,
layout, values, and implementation details remain evidence rather than
additional requirements.

## Maintain through consolidation

Inspect the nearest existing Rules before increasing the system. Resolve the
change in this order:

1. **Keep** — an existing Rule already covers the decision.
2. **Revise** — one existing Rule owns the decision but its wording or boundary
   is incomplete.
3. **Merge** — multiple Rules govern the same choice and can become one clearer
   Rule without losing meaningful boundaries.
4. **Retire** — a Rule is superseded, redundant, unsupported, or no longer
   capable of guiding a decision.
5. **Add** — the proposed Rule passes every quality condition and no existing
   Rule can own it coherently.

Rule count is a budget. Growth earns an explicit explanation of the new,
independent decision the added Rule preserves. Consolidation preserves useful
distinctions while reducing repeated judgment.

Retirement preserves lineage: record what replaced the Rule, or why the design
system no longer carries that decision.

## Keep one owner

Place each fact in the narrowest authoritative artifact:

- Token names, roles, values, and aliases belong to the token contract.
- Component anatomy, variants, states, and allowed behavior belong to the
  component contract or implementation.
- Executable behavior belongs to code and machine-readable contracts.
- Prose Rules carry reusable design judgment that those artifacts cannot fully
  express.

Other artifacts point to the owner instead of restating its meaning. A coherent
change updates every representation required to keep that owner usable, while
leaving unrelated areas stable.

## Write decision-shaped Rules

State the context and the choice:

> When **[context]**, use or preserve **[constraint]** so that
> **[system-level effect]**. **[Meaningful exception, when one exists.]**

Prefer observable choices over aesthetic adjectives. Keep rationale and
evidence linked to the Rule without substituting them for the Rule itself.

## Completion standard

Before recommending a design-system change, rescan the complete reconciled
decision ledger once. Do not stop after finding the first reusable decision.
For every decision, record exactly one primary outcome: proposal evidence,
coverage by an exact existing Rule, local-only, superseded, or open gap. A
final decision cannot become local merely because one component already
covers one of its exceptions.

Related decisions may share one proposal when they govern the same choice and
the merged Rule preserves their triggers, scope, and meaningful exceptions.
Include every merged decision in that proposal's evidence; merging is not a
license to drop the broader decision from the first audit.

Before publishing the review, account for:

- reuse scope;
- supporting and conflicting evidence;
- the nearest overlapping Rules;
- the authoritative owner;
- meaningful exceptions;
- the keep, revise, merge, retire, or add disposition;
- the net effect on Rule count.

For a component proposal, keep approval and application byte-consistent:
serialize at least one canonical proposal evidence id into the component-spec
body's top-level `links`, and include that same id in `evidenceRecordIds`.
Do this before publishing; never add provenance to the frozen body after the
designer accepts it.

Every proposed formal Rule must pass the quality conditions, and every affected
existing Rule must have an explicit disposition. Remaining uncertainty stays
local, candidate, or open.
