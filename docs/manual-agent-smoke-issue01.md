# Issue 02/01 — Manual Real-Agent Smoke Setup & Guide

> You do the real Agent validation; this file is the setup + step-by-step guide.
> Source of truth: `Issues 02/01-runtime-workbench-url-session-shell.md`,
> `IKRAN-MVP-PRD.zh-CN.md`, `docs/adr/0001-pivot-to-agent-desktop-fusion.md`.

This slice makes the **Agent return a Workbench URL**. The Runtime starts (or
reuses) a local HTTP surface on `127.0.0.1` with an auto port + startup-level
session token and returns:

```
http://127.0.0.1:{port}/?session={token}
```

Open it in any browser; the ideal target is the Agent host's **embedded
browser**. The URL is **localhost-only — not a public/remote link**.

## What was built for this slice

- `lib/runtime/runtime-endpoint.mjs` — reuse-or-spawn core: auto free port,
  startup token, `runtime-endpoint.json` reuse state, `openWorkbench()`,
  `composeWorkbenchUrl()`.
- `lib/runtime/session.ts` — honors `IKRAN_SESSION_TOKEN` env so a coordinator
  can compose the URL (token stays in-memory; not persisted by this module).
- `bin/ikran.mjs` — designer CLI entry (`npm start`): auto port, prints the
  Workbench URL, optional auto-open browser (dev convenience only).
- `bin/ikran-mcp.mjs` — minimal MCP stdio server with **one** tool:
  `open_workbench` (returns the Workbench URL). This is what Cursor/Codex spawn.
- Tests: `tests/ikran-runtime-health.spec.ts` (Workbench URL semantics),
  `tests/open-workbench-mcp.spec.ts` (MCP e2e).

## 0. One-time build (only needed for `--prod`; skip for dev mode)

```bash
npm run build
```

> Skip this if you run the MCP server in dev mode (no `--prod`). Dev mode
> (`next dev`) compiles on first `open_workbench` call (slower first call, no
> build step). `--prod` is snappier but requires the build above.

## 1. Recommended flow (snappiest + clean console): start the workbench in `--prod`, let the Agent reuse it

Run in a terminal (`--prod` is recommended for the embedded browser — see the
Known note below for why):

```bash
npm run build                          # one-time (only needed for --prod)
node bin/ikran.mjs --prod --no-open    # prod: production React = clean console in Cursor
```

Zero-build fallback (dev; will show a harmless Cursor-injection warning in the
embedded browser — see Known note):

```bash
npm start                              # = node bin/ikran.mjs (dev, auto port, prints the URL)
```

It prints, for example:

```
[ikran] Workbench URL: http://127.0.0.1:54321/?session=abc...
[ikran] Local-only. Open in any browser (ideal: your Agent host's embedded browser).
```

Keep it running. Then configure Cursor/Codex (below). When the Agent calls
`open_workbench`, the MCP server **reuses** this already-running Runtime and
returns the same URL instantly (it does not spawn a second one).

## Known: Cursor embedded browser shows a hydration warning in dev mode (not an Ikran bug)

Cursor 3's built-in browser / Design Mode annotates page elements with
`data-cursor-ref="e1…"` attributes (for AI element referencing) **before React
hydrates**. In `next dev` (development React) this shows a console warning:
`A tree hydrated but some attributes of the server rendered HTML didn't match
the client properties … data-cursor-ref`. The page works fine — it is exactly
the "browser extension messes with the HTML before React loaded" case React's
own message describes, and `data-cursor-ref` is **not** in Ikran's code.

- It is **dev-only**: production React (`--prod` / `next start`) does not emit
  hydration warnings, so `--prod` gives a clean console. **Use `--prod` for the
  embedded-browser test.**
- If you must run dev in the embedded browser, the warning is harmless — ignore
  it; the shell, health, and SSE all work.

## 2. Cursor MCP config

Add an `ikran` MCP server to Cursor. Project scope (`.cursor/mcp.json`) or user
scope — use an **absolute** path to the repo's `bin/ikran-mcp.mjs`:

```json
{
  "mcpServers": {
    "ikran": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/recursive-design-agent/bin/ikran-mcp.mjs", "--prod"],
      "env": {
        "IKRAN_HOST": "127.0.0.1"
      }
    }
  }
}
```

- Use `--prod` **only** after `npm run build`. For zero-build dev mode, drop
  `--prod` (slower first call).
- If you started the workbench via step 1 with the default state dir
  (`~/.ikran`), the Agent's `open_workbench` reuses it. If you want the Agent's
  Runtime isolated from your manual one, set `"env": { "IKRAN_HOST": "127.0.0.1", "IKRAN_STATE_DIR": "/tmp/ikran-cursor" }`.

After editing, reload Cursor's MCP servers (or restart) so it discovers `ikran`.

## 3. In Cursor chat

Ask the Agent, e.g.:

> Open Ikran / open the Ikran workbench.

Expected: the Agent calls `open_workbench` and returns a
`http://127.0.0.1:<port>/?session=<token>` URL. Open it:

- in Cursor's **embedded browser** if available, **or**
- copy it to a **system browser** (the accepted fallback path).

Confirm:

- the shell renders (`Project set up...`, `Select a Folder`, `Connect Your Agent`),
- `Local runtime connected` (Runtime health),
- the SSE connection stays alive (the connection-state helper stays green; the
  UI deliberately does not show "heartbeat" text).

## 4. Bad-token check (proves session enforcement)

In a terminal (replace `<port>` and `<token>` with the real values):

```bash
# No token -> 403 (rejected):
curl -i -H "host: localhost:<port>" http://127.0.0.1:<port>/api/health

# Real token -> 200:
curl -i -H "host: localhost:<port>" -H "x-ikran-session: <token>" http://127.0.0.1:<port>/api/health
```

Expect `403` for the first, `200` (body contains `ikran-runtime`) for the second.

## 5. Codex Desktop

Configure the same MCP command (Codex Desktop's MCP server config). Ask it to
"open Ikran". Then:

- If Codex **discovers** `open_workbench` and returns a URL → record success.
- If Codex **does not expose/discover** the tool (known gaps: MCP-App rendering
  `openai/codex#21019`; MCP tool exposure `openai/codex#26659` / `#26072`) →
  this is an **accepted outcome for Issue 02/01** (the issue says the Agent may
  "返回 Workbench URL **或**说明当前缺少 MCP tool"). Record the open gap and use
  the **fallback**: run `npm start` yourself and use the printed URL directly.

## 6. Workbench URL is localhost-only — handling guidance

- Do **not** forward the URL to remote hosts, paste it into shared docs, or
  treat it as a shareable/public link. It binds `127.0.0.1` only and the token
  is startup-scoped (it dies with the Runtime process).
- If you paste the URL somewhere for your own use, that's fine — it only works
  on this machine while the Runtime is running.

## 7. Smoke log template (fill in + keep under `.plans/issue02-01/`)

```
Date:
Cursor:
  - open_workbench returned a URL?  [ ] yes  [ ] no (Agent said no tool)
  - URL host:port:
  - Embedded browser opened the shell?  [ ] yes  [ ] n/a
  - System-browser fallback opened the same URL?  [ ] yes  [ ] n/a
  - Shell: "Local runtime connected"?  [ ] yes  [ ] no
  - Bad-token curl → 403?  [ ] yes ; real-token → 200?  [ ] yes
Codex Desktop:
  - Tool discovered?  [ ] yes  [ ] no → open gap: ____ ; fallback used: ____
Notes / open gaps:
```

## Verification already done by the implementation (so you can focus on the Agent path)

- `npm run typecheck` passes.
- `npx playwright test tests/ikran-runtime-health.spec.ts tests/open-workbench-mcp.spec.ts`
  passes: the Workbench URL form opens the shell + health + SSE; bad/no/cross/
  nonlocal tokens are 403; `open_workbench` returns the URL form and reuses the
  Runtime on a second call.