# Workbench motion plans

Audit snapshot: commit `307d4f8` plus the pre-existing uncommitted Workbench changes present on 2026-07-30.

| Plan | Title | Severity | Status |
| --- | --- | --- | --- |
| 008 | Establish shared Workbench motion curves | LOW | DONE |
| 001 | Make F/V mode switching immediate | HIGH | DONE |
| 003 | Scope shared button transitions | MEDIUM | DONE |
| 007 | Correct the shutdown exit easing | HIGH | DONE |
| 002 | Synchronize reduced-motion sheet presence | HIGH | DONE |
| 005 | Remove the partial stage-panel tween | MEDIUM | DONE |
| 004 | Stop animating Alignment layout properties | MEDIUM | DONE |
| 006 | Add reduced-motion coverage to Workbench motion | MEDIUM | DONE |

## Recommended execution order

1. **008** first: every later plan uses the shared curves.
2. **001, 003, 007**: isolated, low-coupling interaction fixes.
3. **002**: sheet presence and keyboard ownership must change together.
4. **005, 004**: remove incoherent and layout-triggering Alignment motion.
5. **006** last: write reduced-motion branches against the final motion surface.

## Additive motion backlog

These were observed during the audit but are intentionally outside this corrective batch because they add new visual behavior:

- Give Seed Reference Notes/Description panels an interruptible exit presence.
- Add press feedback to clickable Design System Browser cards.
- Restore the intended “first Evidence popover animates, subsequent opens are instant” behavior.
