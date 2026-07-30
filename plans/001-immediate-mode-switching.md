# 001 — Make F/V mode switching immediate

- **Status**: DONE
- **Commit**: 307d4f8
- **Severity**: HIGH
- **Category**: Purpose & frequency
- **Estimated scope**: 1 CSS file, small

## Problem

`components/workbench/SeedEvidenceWorkbench.tsx:209` treats F/V as high-frequency keyboard tool switches. Their `data-active` state is rendered by the shared icon-button rule in `components/workbench/seed-evidence-workbench.css:440`:

```css
.small-icon-button {
  transition:
    transform 150ms ease,
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease;
}
```

This makes keyboard mode state lag behind the command by 150ms.

## Target

Only pointer press movement transitions. Active background, border, and icon color update in the same frame as F/V:

```css
.small-icon-button {
  transition: transform 150ms var(--motion-ease-out);
}
```

## Repo conventions to follow

- Motion curves live in `app/globals.css`.
- Keep the existing `data-active` colors and `:active` geometry unchanged.

## Steps

1. Narrow `.small-icon-button` to a transform-only transition.
2. Add a source-contract test proving the mode primitive does not transition background, border, or color.

## Boundaries

- Do not change the F/V keyboard handler or button markup.
- Do not change selected colors, gradients, icon sizes, or layout.
- Do not add dependencies.

## Verification

- Run `npm run test:unit -- tests/unit/workbench-motion-contract.test.ts`.
- Run `npm run typecheck`.
- In Workbench, press F then V repeatedly: selected state must switch immediately; pointer press still settles smoothly.
