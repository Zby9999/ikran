---
name: ikran-extraction
description: Extract an evidence-grounded Ikran Draft Design System when fulfilling a prepare_initial_design_system command, routing completed Alignment decisions into their authoritative design-system owners.
---

# Ikran Extraction

Build the Draft Design System as a minimum sufficient compression of reusable
decisions, not a transcription of the six Alignment sections.

## Mandatory two-call fast path

For a `prepare_initial_design_system` command:

1. Call `claim_initial_design_system_preparation` exactly once.
2. Read its compact frozen semantic context and short `Q01` / `A01` / `D01`
   references.
3. Make the semantic decisions below without further discovery or evidence
   collection.
4. Call `commit_initial_design_system_semantics` exactly once, citing those
   short refs in each `sourceRefs` field.

Do not re-claim, enumerate legacy extraction tools, query SQLite, inspect
Runtime files, or re-extract raw positional/Figma evidence. The Alignment has
already completed that evidence pass. If the compact context does not support
a detail, omit it; do not investigate outside the frozen context.

The Runtime owns stable ids and paths, canonical JSON, source excerpts,
confidence, captures, artifact declarations, work units, residual coverage,
the global audit, and finalization. Never reproduce that bookkeeping.

## Evidence is not ownership

Alignment sections record where a question was asked. An **owner** records
where its answered decision governs future design. Determine ownership from
the decision's meaning, even when evidence crosses several Alignment sections.

Several sources may support one decision. Give each decision one narrow owner;
other artifacts link to that owner instead of restating it. Do not create an
entry merely to account for every source: Runtime records unused sources as
explicit residual omissions.

## Semantic pass

### 1. Select reusable decisions

Read the compact context once. Select only decisions useful for reconstructing
or extending the design language: visual language, principles, foundation
tokens, layout and interaction rules, and component contracts. Prefer a small,
coherent decision set over exhaustive paraphrase. Cite every decision with the
fewest short refs that directly support it.

### 2. Establish scope

Classify what the evidence establishes:

- **Reusable** — explicit intent or repeated evidence establishes wider scope.
- **Candidate** — useful for reconstruction but supported by one surface or a
  reasonable inference. This is the normal Draft default.
- **Local / unsupported** — omit it from the semantic bundle; Runtime preserves
  residual lineage.
- **Conflict** — do not average incompatible sources; omit the unresolved rule
  or express only the shared supported boundary.

Never widen a claim beyond its refs. The Runtime creates a Draft of candidate
entries; later governance decides formalization.

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

The Runtime stores Color, Typography, and Material in one token artifact. Treat
that as storage, not semantics, and keep their meanings distinct.

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

When the context establishes construction facts but not role mapping, preserve
only the supported facts rather than inventing composite roles.

### Material

Separate shared construction and surface decisions from component-local
geometry. Promote a value or scale only when evidence establishes reuse beyond
the observed instance or names the component family it governs.

## Commit once

Before the single commit, make one quick semantic check:

- every entry has direct `sourceRefs`;
- each decision has one owner;
- component-local decisions were not promoted to a global foundation;
- unsupported fields are omitted rather than invented;
- duplicate wording has been compressed.

Then submit the complete semantic bundle once. A successful commit means the
Draft is ready; stop extraction and return control to the designer. If Runtime
returns a validation error, repair only the named field and retry the same
idempotent commit—do not restart discovery.
