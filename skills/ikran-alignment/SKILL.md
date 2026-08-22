---
name: ikran-alignment
description: Prepare evidence-grounded Ikran Design Intent Alignment annotations and questions. Use when fulfilling a prepare_design_intent_alignment command by turning Seed Reference evidence and designer direction into the six Alignment sections.
---

# Ikran Alignment

Prepare questions that resolve design decisions, not questions that ask the
designer to read the evidence for you.

The claimed Runtime `section_contract` is authoritative for section identity,
order, card counts, required fields, language, evidence targets, and completion.
Follow it directly. This Skill governs the semantic judgment that the Runtime
cannot validate: what is worth asserting, what is worth asking, and which
questions have the highest information value.

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
2. Write the section's confirmed observations and reasonable inferences as
   concise Agent Annotations. Each Annotation should expose one meaningful
   interpretation that later extraction may rely on.
3. Generate candidate questions from the remaining decision gaps. A candidate
   survives only when different answers would produce meaningfully different
   design-system output or future design behavior.
4. Rank surviving questions by **information gain**: downstream impact first,
   then uncertainty, then reuse scope. Keep the smallest set that covers the
   section without combining separate decisions.
5. Draft a proposed answer only from current evidence and designer direction.
   Phrase it as the most supported interpretation, with the unresolved boundary
   visible to the designer.
6. Persist the section in the contract's required order, then audit it before
   moving on.

A section is ready when its cards cover its consequential decision gaps,
contain no question answerable by direct evidence inspection, and introduce no
unsupported intent.

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

### Token

Look for repeated values, semantic roles, scales, aliases, and relationships
that could become color, typography, spacing, sizing, radius, shadow, opacity,
motion, or breakpoint tokens.

Ask whether repetition represents a deliberate system, which semantic role a
value serves, how a scale should behave, or where responsive and contextual
exceptions belong. A value visible in Figma is evidence; its intended reuse,
semantic name, and exception policy may be decision gaps.

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
- Questions collectively cover high-impact uncertainty without asking the
  designer to approve the entire design one card at a time.

Preparation is semantically complete only when every retained card passes this
audit and every consequential unresolved decision is either asked in its
primary section or explicitly left as a documented gap.
