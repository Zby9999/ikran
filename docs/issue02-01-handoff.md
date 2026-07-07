# Issue 02/01 — Implementation Handoff (Runtime Workbench URL + Session Shell)

> Source of product truth: `IKRAN-MVP-PRD.zh-CN.md` + `docs/adr/0001-pivot-to-agent-desktop-fusion.md`
> + `Issues 02/01-runtime-workbench-url-session-shell.md`.
> Read those three before touching code. Do NOT use `issues/` (old) or `Design issue/` as
> implementation references (per `AGENTS.md`).

## Goal of this slice

Prove the new Agent-host entry: an Agent asks to "open Ikran", Runtime starts or reuses
the HTTP Workbench surface on `127.0.0.1` with an auto port + startup-level session token,
and returns a copyable Workbench URL `http://127.0.0.1:{port}/?session={token}`. The
Workbench shell (existing `ProjectSetupCard`) opens in any browser and shows health + SSE.

## Architecture choice for this slice (IMPORTANT — read before reviewing)

ADR 0001's target is "one process, two surfaces" (stdio MCP + HTTP Web UI). That full
consolidation is **follow-up work** (ADR "后续工作项 #2"); it is most needed by Issue 02/03,
whose MCP tool handlers must share in-memory record state with the HTTP API.

For **this tracer bullet (02/01)** we use a **two-process coordinator with an env-token
bridge**, because it is the lowest-risk path that keeps the existing passing e2e
(`next start` harness) untouched while still letting Cursor return a real Workbench URL:

- A thin **coordinator process** (the launcher `bin/ikran.mjs` or the MCP server
  `bin/ikran-mcp.mjs`) **generates the startup-level session token**, picks an auto free
  port, spawns the Next HTTP surface (`next dev`/`next start`) as a child with
  `IKRAN_SESSION_TOKEN` + `IKRAN_HOST` + `IKRAN_PORT` in env, waits for readiness, writes a
  user-only `runtime-endpoint.json` (for reuse), and composes/prints/returns the Workbench
  URL. The token is held **in-memory only** (env → process memory via `session.ts`); it is
  never persisted except as part of the user-only reuse state file.
- `lib/runtime/session.ts` is extended so that when `IKRAN_SESSION_TOKEN` is set in env it
  uses that token instead of generating one. When the env is unset (the existing e2e
  harness spawns `next start` directly), it generates a token exactly as today — so
  existing tests are unchanged.

This means Issue 02/03 will later consolidate to true one-process (custom Next server)
when it adds record-mutating tools. **Document this in code comments** so a reviewer sees
the two-process step is deliberate, not an oversight.

## Files

### EDIT — `lib/runtime/session.ts`

`readOrCreateToken()` must honor an externally-provided startup token:

- If `process.env.IKRAN_SESSION_TOKEN` is a non-empty string, use it (and cache it on
  `globalThis.__IKRAN_SESSION_TOKEN` exactly like the generated token, so HMR + same
  startup stay stable).
- Else generate as today (`randomBytes(32).toString("hex")`).
- Keep all existing behavior: `getSessionToken()`, `isValidSession()`, `authorize()`
  (localhost Host + same-origin Origin + valid session via header `x-ikran-session` OR
  `?session=` query, fail-closed 403). Do NOT persist the token to disk from this module.
- Update the header comment to note the env override is how a coordinator process
  (launcher / MCP server) supplies the startup token so it can compose the Workbench URL.

### NEW — `lib/runtime/runtime-endpoint.mjs` (plain JS ESM, shared by both bin files + tests)

`allowJs: false` in tsconfig means tsc ignores this `.mjs` (no typecheck noise). It is
importable by `bin/*.mjs` and by Playwright `.ts` tests (Node ESM resolves `.mjs`).

Exports (all pure-ish, no Next import):

- `pickFreePort(): Promise<number>` — `net.createServer` listen 0 on 127.0.0.1, return
  port, close.
- `composeWorkbenchUrl(host, port, token): string` — returns
  `http://${host}:${port}/?session=${encodeURIComponent(token)}`. (token is hex so encode
  is a no-op, but keep it for safety.)
- `endpointFilePath(stateDir): string` — `path.join(stateDir, "runtime-endpoint.json")`.
- `readRuntimeEndpoint(stateDir): RuntimeEndpoint | null` — read JSON, tolerate missing /
  corrupt (return null).
- `writeRuntimeEndpoint(stateDir, info)` — `mkdirSync(stateDir, {recursive:true})` then
  write JSON with mode `0o600`. Shape: `{ host, port, token, pid, startedAt }`.
- `removeRuntimeEndpoint(stateDir)` — `rmSync(..., {force:true})`.
- `probeRuntimeAlive(host, port, token, timeoutMs=2000): Promise<boolean>` — raw `http.get`
  to `http://${host}:${port}/api/health` with headers `{ host: ${host}:${port},
  "x-ikran-session": token }`; resolve true iff status 200 and body contains the service
  string. (Do NOT use fetch/EventSource; use node http so it works without a browser.)
- `resolveNextBin(cwd): string` — locate `node_modules/.bin/next` (or
  `require.resolve("next/dist/bin/next")`); error clearly if missing.
- `waitForReady(host, port, timeoutMs): Promise<void>` — poll `http://${host}:${port}/`
  (the public HTML shell) until 2xx, like the existing launcher probe. Reject on timeout.
- `openWorkbench({ stateDir, host, prod, cwd, nextDistDir, extraEnv, timeoutMs }): Promise<{ url, host, port, token, pid, spawned }>`
  — the core reuse-or-spawn routine, used by BOTH bin files and the MCP e2e test:
  1. `const existing = readRuntimeEndpoint(stateDir); if (existing) { const alive = await
     probeRuntimeAlive(existing.host, existing.port, existing.token); if (alive) return
     { url: composeWorkbenchUrl(...), ..., spawned:false }; }`
  2. Else spawn: `const port = await pickFreePort(); const token = randomBytes(32).toString("hex");`
     spawn `nextBin` with args `prod ? ["start","-H",host,"-p",String(port)] : ["dev","-H",host,"-p",String(port)]`,
     `cwd`, env `{ ...process.env, IKRAN_HOST:host, IKRAN_PORT:String(port),
     IKRAN_SESSION_TOKEN:token, ...(nextDistDir?{IKRAN_NEXT_DIST_DIR:nextDistDir}:{}),
     ...extraEnv }`, `stdio: ["ignore","pipe","pipe"]`, `detached:false`. Keep the child
     handle; DO NOT inherit stdio (the MCP server's stdout is the MCP channel).
  3. `await waitForReady(host, port, timeoutMs)`.
  4. `writeRuntimeEndpoint(stateDir, { host, port, token, pid: child.pid, startedAt })`.
  5. Return `{ url: composeWorkbenchUrl(host,port,token), host, port, token, pid: child.pid,
     spawned:true }` AND expose the child handle so the caller can kill it on exit. (Return
     `child` too, e.g. `{ ..., child }`.)
  - `host` MUST be localhost-validated by the caller before this (or validate here:
    reject non-localhost with a clear error).

### REWRITE — `bin/ikran.mjs` (the `npm start` / `ikran` designer entry)

Keep it plain JS ESM. Responsibilities:

- Parse args: `--folder <path>` (project folder → `IKRAN_CWD`), `--prod` (next start, needs
  build), `--port <port>`, `--host <host>` (default `127.0.0.1`, reject non-localhost with
  exit 1 + clear message — keep existing behavior), `--no-open`.
- Port resolution: `--port` > `process.env.IKRAN_PORT` > **auto free port** (use
  `pickFreePort()`). This is the PRD "自动端口" change.
- Call `openWorkbench({ stateDir: process.env.IKRAN_STATE_DIR || ~/.ikran-equivalent, host,
  prod, cwd: appDir, nextDistDir: process.env.IKRAN_NEXT_DIST_DIR, extraEnv: { IKRAN_CWD:
  projectFolder }, timeoutMs: 60_000 })`.
- Print, to **stdout** (this is a designer-facing CLI, NOT an MCP server, so stdout is
  fine): a clear block, e.g.
  ```
  [ikran] Workbench URL: http://127.0.0.1:54321/?session=abc...
  [ikran] Local-only. Open in any browser (ideal: your Agent host's embedded browser).
  ```
  Emphasize the Workbench URL is the canonical product entry. Keep the existing auto-open
  browser convenience when `--no-open` is absent, but the printed URL is the source of truth.
- Update the file header comment: the product entry is now the **Workbench URL returned by
  the Agent** (`open_workbench`); the standalone auto-open path remains only as a designer
  dev convenience, **not** this slice's product entry (Issue 02/01 acceptance).
- Lifecycle: on SIGINT/SIGTERM or child exit, kill the child process group and
  `removeRuntimeEndpoint(stateDir)` (only if the endpoint file points at THIS child's pid,
  to avoid clobbering a concurrently-started Runtime — best-effort).
- Preserve `--folder` validation (directory exists) and the `IKRAN_CWD` forwarding.
- `appDir` resolution relative to the launcher (keep existing logic).

### NEW — `bin/ikran-mcp.mjs` (the `open_workbench` MCP stdio server Cursor/Codex spawns)

Plain JS ESM. This is the minimal MCP server for this slice (Issue 02/03 extends it to the
full tool boundary).

- `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";`
- `import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";`
- `import { randomBytes } from "node:crypto";`
- `import { openWorkbench, removeRuntimeEndpoint } from "../lib/runtime/runtime-endpoint.mjs";`
- **CRITICAL — stdout discipline:** MCP stdio uses stdout as the JSON-RPC channel. The
  server MUST NEVER write to stdout except via the transport. All logging → `console.error`
  (stderr) only. The spawned Next child must use `stdio: ["ignore","pipe","pipe"]` (already
  handled in `openWorkbench`) so Next's stdout never reaches this process's stdout.
- Parse args: `--prod` (spawn `next start`; needs build) vs default `next dev`; `--host`
  (default 127.0.0.1, reject non-localhost). Read env `IKRAN_STATE_DIR`, `IKRAN_NEXT_DIST_DIR`,
  `IKRAN_HOST`.
- `const mcp = new McpServer({ name: "ikran", version: "0.1.0" }, { instructions:
  "Ikran local research workbench. open_workbench starts (or reuses) the local HTTP
  Workbench and returns a localhost URL with a startup-level session token. The URL is
  local-only; open it in any browser, ideally this Agent host's embedded browser." });`
- Register ONE tool (zero-arg, no `inputSchema`):
  ```
  mcp.registerTool("open_workbench", { description: "Open the Ikran workbench. Starts or reuses the local Runtime HTTP surface on 127.0.0.1 (auto port) and returns a localhost Workbench URL containing a startup-level session token. Open it in any browser; ideal target is this Agent host's embedded browser. The URL is local-only and is not a public/remote link." }, async () => {
    const r = await openWorkbench({ stateDir, host, prod, cwd: appDir, nextDistDir, extraEnv:{}, timeoutMs: 60_000 });
    // remember r.child so we can kill it on exit
    return { content: [{ type: "text", text: `Ikran Workbench URL:\n${r.url}\n\nLocal-only. Open in any browser (ideal: this Agent host's embedded browser).` }], structuredContent: { url: r.url, host: r.host, port: r.port, session: r.token, reused: !r.spawned } };
  });
  ```
- `const transport = new StdioServerTransport(); await mcp.connect(transport);`
  (`console.error("[ikran-mcp] ready")` — stderr only.)
- Track the spawned child (if any) from the last `openWorkbench` call; on process exit
  (SIGINT/SIGTERM/exit), kill the child (if this process spawned it) and
  `removeRuntimeEndpoint(stateDir)` (only if it owns it, best-effort). If `openWorkbench`
  reused an already-running Runtime (spawned:false), do NOT kill it on exit.
- `appDir` = repo root resolved relative to this file (same pattern as `bin/ikran.mjs`).

### EDIT — tests migration: `tests/ikran-runtime-health.spec.ts`

Migrate from "capture token + hit /api/health" framing to **Workbench URL semantics**.
Keep using the `runtime` fixture (spawns `next start`; session.ts generates a token since
no `IKRAN_SESSION_TOKEN` env is set — capture it via the existing `page.route`
interception of `x-ikran-session`). Then:

- Build the Workbench URL explicitly:
  `const workbenchUrl = \`http://127.0.0.1:${runtime.port}/?session=${token}\`;`
- `await page.goto(workbenchUrl);` — this is the "copy Workbench URL to a system browser"
  path. Assert the shell renders (`Project set up...`, `Select a Folder`, `Connect Your
  Agent`), `runtime-helper` shows `Local runtime connected`, `runtime-service` is
  `ikran-runtime`, and SSE keeps the connection (no "heartbeat" text shown to the user —
  keep existing assertion).
- Keep the API-level security matrix via `rawGet` (valid token 200, no token 403, bad token
  403, cross-origin 403, nonlocal Host 403).
- Rename the describe block / test titles to reflect "Workbench URL + session shell"
  (e.g. `Ikran Issue 02/01 — Workbench URL opens the session shell`).
- Do NOT change the `runtime` fixture or `global-setup`.

### NEW — `tests/open-workbench-mcp.spec.ts` (e2e: the real Agent path through MCP)

- Do NOT use the `runtime` fixture (avoid double-spawning next). Use a per-test temp
  `stateDir` (`mkdtempSync`).
- Env for the spawned MCP server: `IKRAN_STATE_DIR=<temp>`, `IKRAN_HOST=127.0.0.1`,
  `IKRAN_NEXT_DIST_DIR=SHARED_BUILD_DIR` (from `./e2e-constants`), `--prod` (so it spawns
  `next start` against the shared build — fast, build already done by global-setup).
- Use the MCP SDK client:
  `import { Client } from "@modelcontextprotocol/sdk/client/index.js";`
  `import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";`
  `import { composeWorkbenchUrl } from "../lib/runtime/runtime-endpoint.mjs";`
- Spawn + connect:
  ```
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(process.cwd(), "bin/ikran-mcp.mjs"), "--prod"],
    env: { ...process.env, IKRAN_STATE_DIR: stateDir, IKRAN_HOST: "127.0.0.1", IKRAN_NEXT_DIST_DIR: SHARED_BUILD_DIR },
    stderr: "pipe"  // do not inherit; capture to avoid polluting test output
  });
  const client = new Client({ name: "ikran-e2e", version: "0.0.0" });
  await client.connect(transport);
  ```
- `const tools = await client.listTools();` → assert a tool named `open_workbench` exists.
- `const res = await client.callTool({ name: "open_workbench", arguments: {} });` → parse
  `structuredContent.url` (fallback: regex the text content). Assert URL matches
  `/^http:\/\/127\.0\.0\.1:\d+\/\?session=[a-f0-9]{32,}$/`.
- `await page.goto(url);` → assert shell renders + `Local runtime connected` + service
  `ikran-runtime`.
- Call `open_workbench` again → assert **reuse**: same url (same port + token),
  `structuredContent.reused === true`.
- Bad-token check at the API boundary: `await fetch(\`http://127.0.0.1:${port}/api/health\`)`
  (no token) → expect 403; with a bogus `?session=deadbeef` → the page shell still loads
  (public HTML) but `fetch('/api/health', {headers:{'x-ikran-session':'deadbeef'}})` → 403.
- Cleanup: `await client.close();` then kill the MCP child process group + remove
  `runtime-endpoint.json` from `stateDir`; `rmSync(stateDir, {recursive,force})`. Use
  `test.afterEach`. Give the test a generous timeout (e.g. `test(..., { timeout: 90_000 })`)
  since it spawns `next start`.
- Also add a tiny unit assertion for `composeWorkbenchUrl("127.0.0.1", 54321, "abc")` ===
  `http://127.0.0.1:54321/?session=abc` (can be a separate `test` in the same file, no
  server spawn).

### NEW — `docs/manual-agent-smoke-issue01.md` (set up + guidance for the user's manual Agent test)

Write the step-by-step the user will follow (the user does the real Agent test; we only set
up + guide). Include:

1. **Build once (optional, for snappy smoke):** `npm run build`. (Skip to use dev mode; the
   MCP server defaults to `next dev`, slower first call but zero-build.)
2. **Recommended flow (snappiest):** run `npm start` in a terminal — it prints
   `http://127.0.0.1:<port>/?session=<token>`. Keep it running. Then configure Cursor/Codex
   (below) so `open_workbench` reuses this running workbench.
3. **Cursor MCP config** (`.cursor/mcp.json` at project or user scope) — exact JSON:
   ```json
   {
     "mcpServers": {
       "ikran": {
         "command": "node",
         "args": ["/ABSOLUTE/PATH/TO/recursive-design-agent/bin/ikran-mcp.mjs", "--prod"],
         "env": { "IKRAN_HOST": "127.0.0.1" }
       }
     }
   }
   ```
   (Use `--prod` only after `npm run build`; otherwise drop `--prod` for dev mode. Replace
   the absolute path.)
4. **In Cursor chat:** ask the Agent to "open Ikran" / "open the Ikran workbench". Expect
   the Agent to call `open_workbench` and return a `http://127.0.0.1:<port>/?session=<token>`
   URL. Open it in Cursor's embedded browser if available, else copy to a system browser.
   Confirm: the shell renders, "Local runtime connected", SSE alive.
5. **Bad-token check (proves session enforcement):** in a terminal:
   `curl -i -H "host: localhost:<port>" http://127.0.0.1:<port>/api/health` → expect `403`.
   Then with the real token: `curl -i -H "host: localhost:<port>" -H "x-ikran-session: <token>" http://127.0.0.1:<port>/api/health` → expect `200`.
6. **Codex Desktop:** configure the same MCP command. Try "open Ikran". If Codex does not
   expose/discover the tool (known gaps: `openai/codex#21019` MCP-App rendering, and
   `#26659`/`#26072` MCP tool exposure), record the open gap + fallback (use the URL printed
   by `npm start` directly). This is an **accepted** outcome for Issue 02/01 (the issue says
   "Agent 能返回 Workbench URL **或**说明当前缺少 MCP tool").
7. **Smoke log template** (fill in + keep under `.plans/issue02-01/`):
   - Cursor: did `open_workbench` return a URL? (yes/no + the URL host:port)
   - Embedded browser: did the shell open? health? SSE?
   - System browser fallback: did the same URL work?
   - Bad-token `curl`: 403? real-token 200?
   - Codex Desktop: tool discovered? if not, the open gap + fallback used.
8. Note explicitly: Workbench URL is **localhost-only, not a public link**; do not forward
   it to remote hosts or treat it as shareable.

## Acceptance criteria mapping (Issue 02/01)

| Criterion | How met |
| --- | --- |
| Runtime generates `http://127.0.0.1:{port}/?session={token}` | `composeWorkbenchUrl` + `openWorkbench` in `runtime-endpoint.mjs`; printed by `bin/ikran.mjs`; returned by `bin/ikran-mcp.mjs` `open_workbench`. |
| Session token; missing/wrong/expired rejected | existing `authorize()` (unchanged); env-token bridge in `session.ts`; e2e asserts 403 on no/bad token. |
| Shell opens in browser + shows health | existing `ProjectSetupCard` (unchanged UI); e2e navigates the Workbench URL and asserts `Local runtime connected`. |
| Shell establishes SSE heartbeat | existing `/api/events` SSE (unchanged); e2e asserts connection. |
| Runtime binds localhost only, no broad CORS | existing `config.ts` + `authorize()` (unchanged); launcher rejects non-localhost host. |
| Existing health/session tests migrated to Workbench URL semantics | `tests/ikran-runtime-health.spec.ts` rewritten to navigate the explicit `?session=` URL + keep API security matrix. |
| Old standalone auto-open is NOT the product entry | `bin/ikran.mjs` header + output frame the Workbench URL as the entry; auto-open kept only as dev convenience. |
| Real Agent validation (Cursor/Codex/system browser) | `docs/manual-agent-smoke-issue01.md` set up + guidance; user performs manually. |

## Non-goals (do NOT do in this slice)

- The full MCP tool boundary (`create_or_open_project`, `register_seed_reference`, …) —
  that is Issue 02/03. Only `open_workbench` here.
- One-process custom Next server consolidation — follow-up (Issue 02/03).
- tldraw canvas, Evidence Surface, Region Annotation — later slices.
- Any Figma contact by Runtime — never.
- UI/visual changes to `ProjectSetupCard` — it is Figma-owned; do not alter layout/copy/
  icons/styling (per `AGENTS.md`).

## Verification gate (must pass before claiming done)

1. `npm run typecheck` → 0 errors.
2. `npx playwright test tests/ikran-runtime-health.spec.ts tests/open-workbench-mcp.spec.ts`
   → all green (this runs global-setup build once, then the two specs).
3. If either fails, fix and re-run until green. Do not leave failing tests.
4. Confirm `bin/ikran.mjs --no-open` prints a `http://127.0.0.1:<port>/?session=<token>` URL
   and that opening it shows the shell (a quick manual `node bin/ikran.mjs --no-open` +
   `curl` is enough; the e2e already proves the URL form works).

## Key existing references (read these)

- `lib/runtime/session.ts`, `lib/runtime/config.ts`, `lib/runtime/paths.ts`
- `app/api/health/route.ts`, `app/api/events/route.ts`, `app/page.tsx`,
  `components/setup/ProjectSetupCard.tsx`
- `bin/ikran.mjs` (current launcher — being rewritten)
- `tests/fixtures.ts`, `tests/global-setup.ts`, `tests/e2e-constants.ts`,
  `tests/ikran-runtime-health.spec.ts`
- `@modelcontextprotocol/sdk` (1.29.0) — `server/mcp.js` (`McpServer.registerTool`),
  `server/stdio.js` (`StdioServerTransport`), `client/index.js` (`Client`),
  `client/stdio.js` (`StdioClientTransport`). `registerTool(name, {description}, cb)` with
  no `inputSchema` registers a zero-arg tool; cb returns
  `{ content: [{type:"text",text}], structuredContent? }`.