# 008 — Establish shared Workbench motion curves

- **Status**: DONE
- **Commit**: 307d4f8
- **Severity**: LOW
- **Category**: Cohesion & tokens
- **Estimated scope**: 4 CSS files, small mechanical change

## Problem

The Design System Browser owns strong local curves while adjacent Workbench surfaces use hand-written approximations and built-in `ease`/`ease-out`.

Current DSB tokens in `components/workbench/design-system-browser.css:19`:

```css
--dsc-ease: cubic-bezier(0.23, 1, 0.32, 1);
--dsc-drawer-ease: cubic-bezier(0.32, 0.72, 0, 1);
```

## Target

Add shared tokens to `app/globals.css`:

```css
--motion-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--motion-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--motion-ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```

Alias DSB tokens to the shared values and use them for Workbench transform/opacity movement.

## Repo conventions to follow

- Global design tokens live in the existing `:root` block in `app/globals.css`.
- Keep DSB’s `--dsc-*` aliases so the component remains internally scoped.

## Steps

1. Add the three exact curves to `app/globals.css`.
2. Point DSB curve aliases at the shared tokens.
3. Replace selected Workbench transform/opacity hardcodes touched by plans 001, 004, 006, and 007.
4. Add a contract test for exact token values and aliases.

## Boundaries

- Do not create duration tokens in this batch.
- Do not alter color-only hover easing unless the same rule also moves or fades.
- Do not change visual geometry or timing.

## Verification

- Run the motion contract test and typecheck.
- Search production Workbench CSS for duplicate copies of the three cubic-beziers; only the global token definitions should remain.
