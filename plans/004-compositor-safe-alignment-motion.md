# 004 — Stop animating Alignment layout properties

- **Status**: DONE
- **Commit**: 307d4f8
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 1 CSS module and focused tests

## Problem

`components/workbench/alignment-ui.module.css` animates `width` and `grid-template-rows`:

```css
.questionCard {
  transition: width 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
    box-shadow 120ms ease;
}
.answerRegion {
  transition: grid-template-rows 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 120ms ease;
}
.annotationCard {
  transition: width 140ms ease, box-shadow 120ms ease;
}
```

These properties trigger layout inside the tldraw HTML layer.

## Target

- Question and Annotation width changes are immediate.
- Answer geometry opens immediately, with only a 150ms opacity transition.
- Existing size values, card placement, content, and hit targets do not change.

## Repo conventions to follow

- Use `var(--motion-ease-out)` for opacity and shadow feedback.
- Keep state expressed through the existing `data-expanded`, `data-open`, and `data-editing` attributes.

## Steps

1. Remove width from Question and Annotation transition lists.
2. Remove `grid-template-rows` from the Answer transition list.
3. Retain a 150ms opacity transition and existing box-shadow feedback.
4. Add a contract test rejecting animated layout properties in the Alignment module.

## Boundaries

- Do not change card dimensions, tldraw shape props, projection placement, or markup.
- Do not introduce FLIP/JavaScript animation.
- Do not add dependencies.

## Verification

- Run Alignment card and shape unit tests.
- At normal and 10% playback, open a question and annotation editor; geometry must settle immediately without a layout tween, while answer content fades in cleanly.
