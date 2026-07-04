# AGENTS.md

## Design

Prefer the designer's **Figma reference** for all UI / visual / interaction design. If no Figma reference exists for a surface, ask the designer first; only self-design or fill in with explicit confirmation.

**`Design issue/` (including D01–D10) is for designer communication only** — not implementation requirements. Do **not** use it as coding reference.

**`issues/`** describe capability and API boundaries; **concrete UI follows Figma**. When no Figma exists for a surface, ask the designer first — do not make autonomous design changes.

## Commands

- `npm run dev` — start Runtime + UI (Next.js dev, `127.0.0.1:3000`)
- `npm start` — launch via `ikran` (start + open browser)
- `npm run build` — production build
- `npm run check` — typecheck + e2e

Product and architecture details are in `MAP-MVP-PRD.zh-CN.md` and `issues/`.