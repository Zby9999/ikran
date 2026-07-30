# 005 — Remove the partial stage-panel tween

- **Status**: DONE
- **Commit**: 307d4f8
- **Severity**: MEDIUM
- **Category**: Cohesion
- **Estimated scope**: 1 CSS module, small

## Problem

`components/workbench/alignment-ui.module.css:18` animates only panel width:

```css
.stagePanel {
  transition: width 140ms ease, filter 120ms ease;
}
```

At the same time height, padding, background, six `display`-controlled rows, and the Complete tray appear in one frame. The result is a partial horizontal tween attached to an otherwise instant reveal.

## Target

The high-frequency stage chooser expands and collapses immediately as one coherent state. No width or layout transition remains.

## Repo conventions to follow

- Preserve the designer-provided compact and expanded dimensions.
- Preserve hover and `focus-within` access paths.

## Steps

1. Remove the stage-panel transition declaration.
2. Add a contract test ensuring the stage panel does not animate width.

## Boundaries

- Do not change stage labels, colors, dimensions, layout, focus behavior, or completion logic.
- Do not add a new reveal animation without a Figma motion reference.

## Verification

- Run the Alignment stage-panel unit test and motion contract test.
- Hover and keyboard-focus the chooser repeatedly; the whole panel must switch state together with no trailing width tween.
