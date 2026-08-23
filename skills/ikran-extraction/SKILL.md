---
name: ikran-extraction
description: Extract an evidence-grounded Ikran Draft Design System when fulfilling a prepare_initial_design_system command, routing completed Alignment decisions into their authoritative design-system owners.
---

# Ikran Extraction

Build the Draft Design System as a compression of reusable decisions, not a
transcription of the six Alignment sections.

The claimed Runtime `source_contract` is authoritative for schemas, artifact
paths, work-unit shapes, required fields, status eligibility, and completion.
Follow it directly. This Skill governs the semantic judgment that Runtime
cannot validate: how to atomize answered input, establish reuse scope, choose
one authoritative owner, and audit the resulting meaning.

## Evidence is not ownership

Alignment sections record where a question was asked. An **owner** records
where its answered decision governs future design. Determine ownership from
the decision's meaning, even when evidence crosses several Alignment sections.

One answer may yield several atomic decisions with different owners. Several
answers may support one decision. Give each decision one narrow owner; other
artifacts link to that owner instead of restating it.

## Extraction loop

### 1. Atomize

Read the complete frozen Alignment input before writing artifacts. Split every
answered Question, Agent Annotation, and Designer Annotation into the smallest
independent decisions that could change without changing their neighbours.
Preserve the exact source record ids and excerpts that support each decision.

Atomization is complete when each decision has one claim, one coherent
statement, its supporting and conflicting evidence, and no compound choice
hidden behind a shared status.

### 2. Establish scope

Classify what the evidence establishes:

- **Reusable** — explicit designer intent names a reusable scope, or distinct
  evidence supports the same decision across contexts.
- **Candidate** — the decision is useful for reconstruction, but its wider
  scope is supported only by the current surface or a reasonable inference.
- **Gap** — reconstruction or an already-established reuse scope requires a
  decision that available evidence cannot resolve.
- **Local** — the fact describes this surface or content without governing a
  future design choice.
- **Conflict** — credible sources imply incompatible decisions or scopes.

Use candidate as the default for a single-surface observation. Formalize only
when the Runtime contract permits it and explicit evidence supports the exact
decision and its reusable scope. Keep local evidence in lineage rather than
promoting it into a design-system entry.

Scope is complete when every atomic decision has a supported classification
and every uncertainty remains candidate, gap, local, or conflict instead of
being widened by inference.

### 3. Route to one owner

Choose the narrowest owner that can govern the decision completely:

- **Global** — a system-wide design concept or visual-language judgment that
  changes choices across multiple domains.
- **Color** — primitive colors, semantic color roles, component color aliases,
  contrast relationships, and reusable color-use rules.
- **Typography** — type construction facts and complete semantic or component
  type roles.
- **Material** — reusable spacing, size, ratio, radius, border, shadow, and
  opacity decisions that define construction or surface character.
- **Layout** — spatial composition, containers, grids, overflow, breakpoints,
  and responsive relationships across a surface.
- **Interaction** — behaviour or motion strategy shared across components or
  surfaces.
- **Component** — one component's boundary, anatomy, variants, viewport
  variants, states, behaviour, content tolerance, and allowed customization.

Route a component's internal spacing, radius, or motion to its Component until
evidence establishes a shared foundation or cross-component strategy. Route
breakpoints and responsive composition to Layout. Route duration, easing, and
state feedback to Interaction or the affected Component.

Routing is complete when every mapped or gap decision has exactly one semantic
owner and no entry repeats a decision owned elsewhere.

## Foundation owners

The Runtime may store Color, Typography, and Material in one token artifact or
one `tokens` work unit. Treat that as storage, not semantics. Complete three
separate reasoning passes and audit each owner before considering the combined
work unit complete.

### Color

Separate construction values from roles and rules. A palette alone is not a
Color system: map supported values to the jobs they perform, while keeping
scope and exceptions explicit.

### Typography

Preserve both layers:

1. construction facts — family, size, weight, line height, letter spacing, and
   text transform;
2. composite roles — the supported combinations used for body, display,
   metadata, actions, or other named jobs.

When the evidence establishes a type hierarchy that must be reconstructed but
cannot establish its role mapping, record explicit gaps. Preserve atomic facts
as construction evidence rather than inventing composite roles from them.

### Material

Separate shared construction and surface decisions from component-local
geometry. Promote a value or scale only when evidence establishes reuse beyond
the observed instance or names the component family it governs.

## Materialize progressively

Compose entries from the routed decisions, then declare and record the matching
Runtime output work unit. Claims may cite any Alignment section. Keep each
entry's links equal to the evidence that supports the decisions it actually
contains.

When several decisions share one entry, its status cannot exceed the weakest
decision it contains. Prefer smaller coherent entries when mixed evidence
would otherwise hide that boundary.

Use outcomes deliberately:

- `mapped` for a decision represented by its owner;
- `gap` for an unresolved decision represented as an explicit gap entry;
- `omitted` for local, duplicate, or non-design-system evidence, with the
  specific disposition in the reason;
- `conflict` while incompatible evidence remains unresolved.

## Bidirectional audit

Audit meaning after all work units are present:

1. **Input → output** — every frozen source record is split into claims and each
   claim has a mapped, gap, omitted, or conflict disposition.
2. **Output → input** — every entry and every substantive field is supported by
   the linked claims; no status or prose exceeds that evidence.
3. **Owner audit** — each decision has one owner; Color, Typography, and
   Material have been checked independently; component-local and cross-system
   decisions are separated.
4. **Contradiction audit** — conflicting sources remain visible and do not
   become an averaged rule.
5. **Compression audit** — duplicate, incidental, and merely descriptive
   entries are consolidated or returned to local evidence.

Extraction is semantically complete only when every audit passes, every
remaining uncertainty is explicit, and the Draft can explain both why each
decision exists and why each source input was not promoted further.
