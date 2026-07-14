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

## Workflow vs Ikran MCP

`workflow/` Skills are **project guidance and background only**. They are **not** part of the Ikran MCP server, are **not** packaged into MCP, and are **not** the place to encode Ikran product behavior (tool orchestration, evidence declaration, Workbench flows).

- Do **not** edit files under `workflow/` for Ikran Runtime / MCP / Workbench work.
- Ikran Agent conventions belong in Ikran surfaces (e.g. MCP `instructions`, tool descriptions, `AGENTS.md`, `Issues 02/`, product docs) — not in `workflow/` Skills.
- `workflow/` Skills may still inform design-agent methodology for this repository; treat them as foundation context for the project, not as Ikran MCP configuration.

### Issue tracker

Implementation issues live as markdown under `Issues 02/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default triage vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
