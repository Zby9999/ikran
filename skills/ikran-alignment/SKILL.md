---
name: ikran-alignment
description: Prepare evidence-grounded Ikran Design Intent Alignment annotations and decision questions. Use when fulfilling a prepare_design_intent_alignment command, including separating Color, Typography, and Material decisions inside the Token section.
---

# Ikran Alignment

Prepare questions that resolve design decisions, not questions that ask the
designer to read the evidence for you.

The claimed Runtime `section_contract` is authoritative for section identity,
order, card counts, required fields, language, evidence targets, and completion.
Follow it directly. This Skill governs the semantic judgment that the Runtime
cannot validate: what is worth asserting, what is worth asking, and which
questions have the highest information value.

## Answer monitoring continuation

After preparation, Alignment answer monitoring is one continuous Agent turn,
not a one-shot status check. Every successful finalize, record, or resume result
with `continuationRequired: true` is a binding continuation contract:

1. Execute the returned `nextAction` immediately.
2. When a ready section is returned, send only that section's stable-keyed
   decisions and `draftPatch` to
   `record_incremental_initial_design_system_plan`. Runtime merges the patch,
   owns cumulative bindings, and returns the complete Draft for global review;
   never resend that complete Draft as input.
3. When no section is ready and Alignment is still open, call
   `resume_initial_design_system_planning` again.
4. When Alignment is completed, consume the final checkpoint and call
   `commit_incremental_initial_design_system_plan` rather than reporting that
   Alignment is merely complete.

Do not send a final response, status summary, or generic wait call while
`continuationRequired` is true. The first normal human-review boundary is a
successful Draft commit with `continuationRequired: false` and
`terminalBoundary: draft_design_system_review`. Stop there until the designer
explicitly confirms the visible Draft; only then may Prototype begin.

## Decision gaps

A **decision gap** is an uncertainty whose answer would change a reusable design
choice, the interpretation of the Seed Reference, or the boundary of a future
design-system rule.

Classify every relevant finding before writing cards:

- **Confirmed observation** — directly supported by the available evidence or
  explicit designer direction.
- **Reasonable inference** — the evidence supports one interpretation, but does
  not prove the designer's intent.
- **Decision gap** — multiple consequential interpretations remain, or the
  evidence cannot show the intended behavior or reuse boundary.

Put confirmed observations and reasonable inferences in Agent Annotations with
their honest inference status. Turn only decision gaps into Question cards.
Designer Annotations are direction: use them to resolve or narrow gaps, and
preserve their authorship rather than restating them as Agent findings.

Classification is complete when every proposed Annotation and Question has a
specific evidence anchor, an honest status, and one Alignment section.

## Preparation loop

For each section in the claimed contract:

1. Inspect the available Seed Reference evidence, Design Language Description,
   Reference Notes, and section-bound Designer Annotations. Follow the current
   Ikran evidence-routing instructions; treat missing evidence as uncertainty.
2. Record confirmed observations and reasonable inferences as concise Agent
   Annotations.
3. Rank the remaining decision gaps by downstream impact, uncertainty, and
   reuse scope. Retain gaps whose answers would meaningfully change downstream
   design behavior or design-system output.
4. Draft the highest-value Question and its supported proposed answer. Rescan
   the evidence and section lens for another distinct, consequential gap; repeat
   until the Runtime maximum or **saturation**.
5. Persist the section in the contract's required order, then audit it before
   moving on.

Saturation means every relevant part of the section lens has been checked and
each remaining uncertainty is resolved, directly inspectable, duplicate,
unsupported, or inconsequential. The Runtime minimum is a validity floor:
continue beyond it while a qualifying gap remains. Use each card for one
distinct decision, leaving unused capacity when saturation occurs below the
maximum.

## Section lenses

Use the lenses to find decisions, not to manufacture coverage. A lens with no
supported observation or consequential gap may remain quiet within the
Runtime's coverage requirements.

### Design Concept

Look for the intended outcome, experience qualities, hierarchy of principles,
and the idea that makes the surface coherent. Determine which qualities are
system-level invariants and which belong only to this page or content.

Ask when the same composition supports multiple plausible intentions, when two
principles could conflict, or when the reuse scope of an apparent principle is
unclear. Keep concrete color, spacing, and component decisions in their own
sections.

### Visual Language

Look for relationships among contrast, color roles, typography voice, imagery,
shape, density, material, and visual rhythm. Describe relationships before
isolated values: what dominates, recedes, repeats, or creates character.

Ask which visible relationships are intentional and reusable, how expressive
elements should vary, or where consistency should yield to content. Treat
extractable properties as observations; ask about their meaning or scope only
when that remains unresolved.

### Token (Foundations)

`token` is the Runtime section identity and an evidence lens, not a Draft
Design System destination. Inspect three distinct foundation lenses, then rank
their decision gaps together within the section's card limit. A lens with no
consequential gap does not need its own Question.

#### Color

Look for primitive values, semantic roles, contrast relationships, component
references, and rules that govern how color creates hierarchy or feedback.

Ask about role, reuse scope, and exceptions when they remain uncertain. Treat
an inspectable color value as an observation; ask what job it performs rather
than asking the designer to repeat the value.

#### Typography

Look for family, size, weight, line height, letter spacing, text transform,
scale relationships, and complete roles such as body, display heading,
metadata, or action label.

Ask which combinations form reusable roles, how the scale is intended to work,
and where responsive or contextual exceptions apply. Keep construction facts
and their composite roles visible as separate findings.

#### Material

Look for spacing, size, ratio, radius, border, shadow, and opacity decisions
that define shared construction or surface character.

Ask whether repeated values form a system, apply to a component family, or
belong only to the observed surface. Route structural breakpoints and
responsive composition questions to Layout. Route duration, easing, and state
feedback questions to Interaction or the affected Component.

Frame each retained gap so the answer establishes its intended reuse boundary.
The extraction stage chooses the final owner after the designer answers.

### Layout

Look for containers, grids, alignment lines, spacing rhythm, proportions,
ordering, density, overflow, and the relationship between fixed structure and
variable content.

Ask how the structure responds to viewport or content changes, which alignments
must persist, and which proportions are rules rather than artifacts of the
sample. Separate page composition from a reusable component's internal anatomy.

### Component

Look for reusable boundaries, anatomy, slots, variants, states, composition,
content tolerance, and repeated elements that appear to share one contract.

Ask what constitutes one component, which differences are variants, what may be
customized, and where reuse stops. Prefer questions that determine a component
contract over requests to name every visible element.

### Interaction

Look for controls, navigation, selection, disclosure, continuity cues, and any
visible states or prototype evidence. Static appearance usually proves less
about interaction than about the other sections.

Ask about triggers, state transitions, feedback, focus, keyboard behavior,
motion purpose, persistence, and unavailable loading, empty, error, or disabled
states when their answers affect the system. Keep proposed answers conservative
when the evidence is static.

## Question quality

Every Question card should pass all of these tests:

- **Decision-shaped** — an answer selects or bounds a design choice.
- **Evidence-grounded** — the question points to the exact observation that
  created the uncertainty.
- **Single** — one card asks for one decision that can receive one clear answer.
- **Consequential** — plausible answers lead to different downstream behavior.
- **Scoped** — the designer can tell whether the decision concerns this surface,
  a component family, or the wider design system.
- **Neutral** — the wording permits correction; the proposed answer carries the
  Agent's best-supported interpretation without disguising it as fact.
- **Distinct** — another card or Designer Annotation does not already resolve
  the same decision.
- **Routable** — the decision exposes its reuse boundary clearly enough for
  downstream owner selection; the Alignment section itself is not that owner.

Prefer “Should the compact spacing remain specific to dense metadata, or define
the system's default rhythm?” over “Is the spacing 8 px?” The first resolves
scope; the second asks the designer to repeat inspectable evidence.

## Cross-section audit

Before finalizing preparation, account for every card:

- Each Annotation states evidence or inference, never a hidden question.
- Each Question resolves a decision gap, never an inspectable fact.
- Each proposed answer is supported and remains editable in meaning and tone.
- Each concern has one primary section; linked consequences in other sections
  do not become duplicate questions.
- The Token section has independently inspected Color, Typography, and Material;
  its retained cards are the highest-value gaps across those lenses rather than
  mechanical one-per-lens coverage.
- Questions collectively cover high-impact uncertainty without asking the
  designer to approve the entire design one card at a time.

Preparation is semantically complete only when every retained card passes this
audit and every consequential unresolved decision is either asked in its
primary section or explicitly left as a documented gap.
