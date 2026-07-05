# AGENTS.md

## Design

Prefer the designer's **Figma reference** for all UI / visual / interaction design. If no Figma reference exists for a surface, ask the designer first; only self-design or fill in with explicit confirmation.

**`Design issue/` (including D01–D10) is for designer communication only** — not implementation requirements. Do **not** use it as coding reference.

**`issues/`** describe capability and API boundaries; **concrete UI follows Figma**. When no Figma exists for a surface, ask the designer first — do not make autonomous design changes.

## UI Components

Prefer shadcn/ui components in `components/ui` before building custom UI. Customize shadcn components to match the Figma reference; do not replace Figma visuals with shadcn defaults.

For new primitives, use the shadcn CLI and keep custom variants in the shadcn component file. Add separate custom components only when shadcn has no suitable primitive.

## Commands

- `npm run dev` — start Runtime + UI (Next.js dev, `127.0.0.1:3000`)
- `npm start` — launch via `ikran` (start + open browser)
- `npm run build` — production build
- `npm run check` — typecheck + e2e

Product and architecture details are in `IKRAN-MVP-PRD.zh-CN.md` and `issues/`.
