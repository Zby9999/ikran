# 007 — Correct the shutdown exit easing

- **Status**: DONE
- **Commit**: 307d4f8
- **Severity**: HIGH
- **Category**: Easing & duration
- **Estimated scope**: 1 CSS file, tiny

## Problem

`components/workbench/seed-evidence-workbench.css:49` uses an `ease-in` exit:

```css
.seed-workbench__shutdown-prompt[data-state="closed"] {
  animation: shutdown-prompt-out 140ms ease-in;
}
```

The confirmation starts slowly at the moment the user is waiting for the system response.

## Target

```css
animation: shutdown-prompt-out 140ms var(--motion-ease-out);
```

The exact shared curve is `cubic-bezier(0.23, 1, 0.32, 1)`.

## Repo conventions to follow

- Keep the existing Figma-specified transform origin, keyframes, duration, and geometry.

## Steps

1. Replace `ease-in` with the shared strong ease-out token.
2. Add a contract test rejecting `ease-in` in Workbench UI motion.

## Boundaries

- Do not redesign the confirmation or replace Radix Dialog.
- Do not change shutdown behavior or timing.

## Verification

- Run the motion contract test.
- Open and dismiss the confirmation at 10% playback; exit must start immediately and settle toward the end.
