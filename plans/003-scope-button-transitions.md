# 003 — Scope shared button transitions

- **Status**: DONE
- **Commit**: 307d4f8
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 2 component files, small

## Problem

`components/ui/button.tsx:8` and `components/workbench/button.tsx:12` use `transition-all`. Dense Workbench controls inherit a 150ms transition for every changing property:

```ts
"... transition-all ... active:not-aria-[haspopup]:scale-[0.99] ..."
```

## Target

Transition only the properties used by the button primitives:

```text
color, background-color, border-color, box-shadow, opacity, transform
```

Use 150ms and `var(--motion-ease-out)`.

## Repo conventions to follow

- Keep variants in their existing shadcn/component files.
- Preserve every existing class except the transition utility replacement.

## Steps

1. Replace `transition-all` in `components/ui/button.tsx` with an explicit property list.
2. Apply the same change to the Workbench-specific button primitive.
3. Add a contract test rejecting `transition-all` in both primitives.

## Boundaries

- Do not change variants, colors, dimensions, focus rings, or press transforms.
- Do not change consuming components.
- Do not add dependencies.

## Verification

- Run the motion contract test and typecheck.
- Inspect Refresh, Notes, Description, answer-submit, and setup buttons; hover, focus, disabled, and press states must remain intact.
