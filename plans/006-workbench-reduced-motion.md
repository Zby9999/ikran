# 006 — Add reduced-motion coverage to Workbench motion

- **Status**: DONE
- **Commit**: 307d4f8
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 2 CSS files, medium

## Problem

Alignment width/answer motion and Workbench loading spinners do not respond to `prefers-reduced-motion`. The only reduced-motion rule in `seed-evidence-workbench.css` currently targets the shutdown prompt.

## Target

- Alignment geometry changes immediately; answer opacity may fade for 150ms.
- Seed action hints and panels keep opacity feedback but drop translate movement.
- Continuous rotation becomes a gentle opacity pulse:

```css
@keyframes workbench-loading-pulse {
  from { opacity: 0.45; }
  to { opacity: 1; }
}
```

- No Reduced Motion branch removes semantic loading or state feedback.

## Repo conventions to follow

- Reuse `var(--motion-ease-out)` and `var(--motion-ease-in-out)`.
- Keep the Design System Browser reduced-motion implementation separate; it is already scoped and correct.

## Steps

1. Add an Alignment reduced-motion branch covering stage, question, answer, and annotation motion.
2. Add fade-only keyframes for Seed Reference tip/panel entrances.
3. Replace rotation with the opacity pulse under Reduced Motion.
4. Test selector and keyframe presence in the motion contract test.

## Boundaries

- Do not remove loading indicators.
- Do not change normal-motion behavior beyond other selected plans.
- Do not change focus-mask behavior in this plan.

## Verification

- Run the motion contract test and typecheck.
- Emulate Reduced Motion: spinner position must stay fixed, hints/panels must not translate, and useful opacity feedback must remain.
