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

## Cursor Cloud specific instructions

Environment/services for the single Ikran Runtime product (Next.js 16 + MCP + SQLite via `node:sqlite`). Standard commands are in `## Commands` above; notes below are non-obvious caveats.

### Node 24 is required (critical)

The runtime launcher (`bin/ikran-runtime.mjs`, used by `npm start`, the MCP stdio bridge `bin/ikran-mcp.mjs`, and the MCP e2e specs) `import()`s `.ts` modules through `tsx`. Under Node 22, `tsx` collapses those modules' named exports into `default`, so the runtime crashes with `createRuntimeLifecycle is not a function` and MCP e2e specs fail with `MCP error -32000: Connection closed`. Node 24 fixes this. Plain `npm run dev` (`next dev`) does **not** hit this path, but `npm start` and `npm run test:e2e` do.

Node 24 is wired as the default in this VM: nvm has v24 (nvm default → 24), `node`/`npm`/`npx` are symlinked into `/usr/local/cargo/bin` (first on `PATH`, ahead of `/exec-daemon/node` which is v22), and `~/.bashrc` also prepends the v24 bin. So `node -v` should report v24 in any shell. If a future agent ever sees `/exec-daemon/node` (v22) via bare `node`, re-establish the symlinks or run commands with `bash -lc`.

### Running the app in dev

`npm start` (the `ikran` launcher) boots the persistent Runtime (Next dev + MCP over a unix socket at `$IKRAN_STATE_DIR/runtime-mcp.sock`), binds a project folder, and prints a Workbench URL containing `?session=<token>&view=workbench`. In this headless VM:

- `IKRAN_FIGMA_CREDENTIAL_STORE=memory npm start -- --folder <dir> --no-open` (no macOS Keychain; `--no-open` since there's no browser to auto-launch — open the printed URL yourself).
- Add `IKRAN_FIGMA_API_MODE=mock` to avoid real `api.figma.com` network. In mock mode the Figma Connection Gate accepts any token starting with `figd_ok` (e.g. `figd_ok_demo`).
- The Runtime is a detached single-project-per-process daemon; logs go to `$IKRAN_STATE_DIR/runtime.log` (default `~/.ikran`). Stop it with `ikran stop` (or the Workbench Shutdown control); `ikran status` reports it. Most UI writes (seed capture) come from the Agent via MCP, not the browser.

### Tests

`npm run test:e2e` runs one `next build --webpack` into `.next/e2e-build` in Playwright `globalSetup` (~40s) before workers, then spawns an isolated Runtime per worker. Chromium must be installed (`npx playwright install chromium`). Under parallel load, the coordinate-based "click outside dismisses shutdown confirmation" case in `tests/seed-evidence-workbench.spec.ts` is occasionally flaky (click lands over the dialog); it passes in isolation / on retry. `npm run test:unit` (Vitest) needs no build or external services.
