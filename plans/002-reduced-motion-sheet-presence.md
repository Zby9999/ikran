# 002 — Synchronize reduced-motion sheet presence

- **Status**: DONE
- **Commit**: 307d4f8
- **Severity**: HIGH
- **Category**: Accessibility
- **Estimated scope**: 3 TypeScript files, 1 CSS contract test

## Problem

`components/workbench/design-system-browser.css:804` reduces the sheet transition to 1ms, while `components/workbench/design-system-browser.tsx:72` keeps it mounted for 400ms:

```ts
export const DESIGN_SYSTEM_SHEET_EXIT_MS = 400;
```

`components/workbench/SeedEvidenceWorkbench.tsx:152` owns F/V keyboard input until the same 400ms timer completes. Reduced-motion users therefore see an invisible sheet while keyboard input is still swallowed.

## Target

- Normal motion: keep the existing 400ms presence window covering the 350ms drawer transition.
- Reduced motion: use a 150ms presence window matching the retained scrim opacity fade.
- The internal sheet presence and parent keyboard-ownership timer must use the same computed duration.

## Repo conventions to follow

- Put the reusable `matchMedia("(prefers-reduced-motion: reduce)")` hook under `components/workbench/`.
- Keep the existing CSS reduced-motion rule: transform motion ends in 1ms; scrim opacity remains 150ms.

## Steps

1. Add a reusable reduced-motion preference hook.
2. Export a pure `designSystemSheetExitMs(reduced: boolean)` helper returning 400 or 150.
3. Pass the computed duration into `useSheetPresence`.
4. Use the same duration in `SeedEvidenceWorkbench` when releasing keyboard ownership.
5. Test both duration branches and the shared usage contract.

## Boundaries

- Do not change sheet geometry, scrim opacity, focus-trap behavior, or normal-motion duration.
- Do not change Runtime/API state.
- Do not add dependencies.

## Verification

- Run the Design System Browser unit tests and the motion contract test.
- With normal motion, close the sheet and confirm its full drawer exit completes.
- With Reduced Motion enabled, close the sheet and press F after the 150ms scrim fade; Annotation mode must activate.
