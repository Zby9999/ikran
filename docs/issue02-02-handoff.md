# Issue 02/02 — Implementation Handoff (Project Session Binding + `.ikran` Migration)

> Source of product truth: `IKRAN-MVP-PRD.zh-CN.md` + `docs/adr/0001-pivot-to-agent-desktop-fusion.md`
> + `Issues 02/02-project-session-binding-ikran-metadata.md`.
> Read those before touching code. Do NOT use `issues/` (old) or `Design issue/` as
> implementation references (per `AGENTS.md`).

## Goal of this slice

Migrate the existing project-folder binding, cwd auto-bind, and `.ikran/`
initialization into the new **project/session context** where the Workbench HTTP
API and the Agent's MCP tools operate on **the same project**. The Runtime holds
the project binding for the current session and persists the `.ikran/` basis
(SQLite, event log, config) for it. The Agent gets a project tool
(`create_or_open_project`) that binds / opens the project and **fails closed on
project mismatch**, mirroring the HTTP side's existing
`/api/agent/connect` 409.

After this slice: a designer binds a folder via the UI (unchanged), **or** an
Agent binds/opens it via MCP; both reach the same Runtime active-project binding;
refresh recovers it; an MCP tool that references a different project than the
Runtime's current binding is rejected (fail-closed).

## UX refinement (added during this slice)

Because Ikran is now a plugin opened inside the Agent's conversation, **the
working folder is chosen before the conversation** (the folder the user opens in
the Agent host). So the folder step no longer picks a folder:

- `bin/ikran-mcp.mjs` discovers the Agent host's working folder via
  `discoverWorkingFolder()` and forwards it to the Runtime as `IKRAN_CWD`, so the
  Workbench knows which folder to bind. Discovery order: explicit
  `process.env.IKRAN_CWD` (an mcp.json env override) > **MCP Roots**
  (`mcp.server.listRoots()` — the client exposes its workspace folders; the first
  `file://` root → path) > none. It deliberately does NOT use `process.cwd()`
  (Cursor sets that to a user folder). A `list_working_folders` tool surfaces the
  discovery (folder + source + roots). If nothing is discovered, no `IKRAN_CWD` is
  forwarded and `create_or_open_project({})` returns `no_working_folder` (the Agent
  then passes `{ path }` — its shell `pwd` gives the workspace).
- `bin/ikran-mcp.mjs` also exposes `setup_workspace({ path })` — a universal,
  non-Roots bootstrap. The Agent passes `pwd`; the tool returns the exact MCP
  config snippet (`mcpServers.ikran` with `cwd = <path>` and
  `env.IKRAN_STATE_DIR = <path>/.ikran`) for the **Agent** to write into
  `<path>/.cursor/mcp.json` (the tool does NOT write — transparent, non-invasive),
  then reload Cursor's MCP servers. After the reload the server launches in the
  right workspace with **per-project state** (`IKRAN_STATE_DIR = <workspace>/.ikran`
  → each project gets its own active-project pointer + Runtime → side-by-side
  projects are isolated). For the current session the Agent also calls
  `create_or_open_project({ path })` to bind now. Roots remains the zero-config
  auto path; `setup_workspace` is the universal fallback that also adds persistence
  + per-project isolation.
- `ProjectSetupCard` / `FolderSelectStep`: the folder step **auto-completes** when
  `.ikran` already exists in the working folder (resume), or offers a one-click
  **Initialize here** that creates `.ikran/` in that folder (empty *or* alongside
  existing files). The native folder picker and the manual path-input fallback
  were **removed**; the `inside-folder` variant + its "Use this folder directly"
  sub-button were removed. Label `Select a Folder` → `Project Folder`; helper copy
  changed per-state. **Visual layout unchanged** (final wording pending Figma).
- Removed `app/api/project/select-folder/route.ts` + `lib/runtime/folder-picker.ts`.
  `cwd-candidate.ts` `isAutoBindable` is now resume-only (an empty folder waits for
  the click, not a silent auto-bind).
- There is **no UI folder-switch** anymore (single-project-single-flow). To change
  projects, restart Ikran with the new folder as the workspace (the MCP server
  rediscovers it via Roots / `IKRAN_CWD` env). The HTTP `/api/project/bind` still
  switches (programmatic), but the UI does not expose it.
- Tests updated: `cwd-auto-bind` (init → click; manual → click row; resume auto),
  `ikran-runtime-health` (`Project Folder` label), `agent-switch` (removed the two
  picker-based folder-switch tests; kept agent-failure + duplicate-click),
  `project-session-mcp` (roots/list discovery + `list_working_folders` + the
  `no_working_folder` fallback + `setup_workspace` config snippet; the
  explicit-path/mismatch/refresh test remains).

The `create_or_open_project` MCP tool + mismatch fail-closed (below) are
enhanced (no-`path` now discovers the working folder via Roots / env) and still
fit: the Agent binds/opens that one working folder and fails closed if it
references a different one.

## What already exists (from the old `issues/` set — DO NOT re-implement)

These are load-bearing and unchanged by this slice:

- `lib/runtime/project.ts` — `validateProjectFolder`, `bindProjectFolder`
  (creates `.ikran/`, `artifacts/`, `export/`, `config.json`; inits SQLite; logs
  `project_created` + `folder_selected`; sets the active-project pointer),
  `getActiveProject`, `getActiveProjectState`, `loadProjectConfig`,
  `projectPathsMatch` (canonical-path compare), `setActiveProject`,
  `getRuntimeConnectedAgent`, `setRuntimeConnectedAgent`.
- `lib/runtime/paths.ts` — `.ikran/` path conventions + the Runtime-global
  `~/.ikran/runtime-state.json` active-project pointer (overridable via
  `IKRAN_STATE_DIR` for test isolation).
- `lib/runtime/db.ts` — per-project `.ikran/ikran.db` SQLite (events, projects,
  tasks tables) + `initializeProjectDb` (open + schema + close, no leaked handle).
- `lib/runtime/events.ts` — `logEvent` (SQLite + `.ikran/events.jsonl`).
- `lib/runtime/cwd-candidate.ts` — `getCwdCandidate` (resume / init / manual).
- HTTP API: `GET /api/project` (active project + cwd candidate), `POST
  /api/project/bind` (bind; **keeps its switch-freely behavior** — the
  programmatic/HTTP path; the UI no longer exposes a folder picker after the UX
  refinement), `POST /api/agent/connect` (**already** fails closed with 409
  `project_mismatch`). (`POST /api/project/select-folder` was removed in the UX
  refinement.)
- `lib/runtime/session.ts` — startup-level session token + `authorize()`
  (localhost Host + same-origin Origin + valid session → else 403). Honors
  `IKRAN_SESSION_TOKEN` env (the coordinator bridge from Issue 02/01).
- `bin/ikran.mjs` (designer CLI), `bin/ikran-mcp.mjs` (MCP server, `open_workbench`
  only), `lib/runtime/runtime-endpoint.mjs` (reuse-or-spawn core) — from 02/01.
- UI: `components/setup/ProjectSetupCard.tsx` already recovers project +
  connected_agent after refresh and auto-binds the cwd candidate.
- Tests: `tests/project-folder-binding.spec.ts` (HTTP bind + `.ikran` + refresh
  recovery + `/api/agent/connect` mismatch 409), `tests/cwd-auto-bind.spec.ts`,
  `tests/open-workbench-mcp.spec.ts`.

So **`.ikran` (SQLite + event log + config), refresh recovery, and the HTTP-side
mismatch enforcement already exist.** The NEW work is the **MCP side**: a project
tool that shares the same binding and fails closed on mismatch.

## Architecture choice for this slice (IMPORTANT — read before reviewing)

This slice stays on Issue 02/01's **two-process coordinator + env-token bridge**
(ADR 0001). The MCP server (`bin/ikran-mcp.mjs`) and the Next HTTP surface are
still separate processes. They share the **project/session context** through the
existing single source of truth: the Runtime-global active-project pointer
(`~/.ikran/runtime-state.json`, scoped by `IKRAN_STATE_DIR`) and the startup
session token (env bridge). Both processes get the same `IKRAN_STATE_DIR`
(openWorkbench forwards `process.env` to the spawned Next child) and the same
`IKRAN_SESSION_TOKEN`.

**The MCP `create_or_open_project` tool does NOT duplicate binding logic.** It is
a thin policy layer that **proxies to the existing HTTP API**:

1. `ensureRuntime()` — call `openWorkbench` (reuse-or-spawn) so the HTTP surface
   is up and we hold `{ host, port, token, url }`. This guarantees the token the
   MCP tool uses is the same token the HTTP `authorize()` accepts.
2. `GET /api/project` (with `x-ikran-session: token`) — read the Runtime's
   current active project. This is the shared binding.
3. Apply the **mismatch policy in the MCP layer** (canonical-path compare):
   - no `path` → OPEN current (read-only): return the active project + session +
     workbench_url.
   - `path` given, no active → CREATE: `POST /api/project/bind { path }`
     (the HTTP route does validate + mkdir + SQLite + events + set-active).
   - `path` given, active == path (canonical) → OPEN idempotent: return current.
   - `path` given, active != path (canonical) → **FAIL CLOSED**: return
     structured `{ ok:false, error:"project_mismatch", expected, active }`. Do
     NOT bind / switch.

Because the MCP tool reads the active project FROM the HTTP API and binds THROUGH
the HTTP API, **MCP and HTTP are guaranteed to operate on the same project** —
there is literally one binding, owned by the Runtime. The fail-closed policy lives
in the MCP layer because the Agent (unlike the designer) must not silently switch
projects in a single-project-single-flow session (PRD: "MVP 是单项目、单流程").

**One-process consolidation** — where MCP tool handlers share in-memory record
state with the HTTP API in a single custom Next server, instead of proxying over
HTTP — is deliberate **follow-up work for Issue 02/03** (ADR "后续工作项 #2").
Do not collapse this into one process here. Document this in code comments so a
reviewer sees the two-process step is deliberate.

## Mismatch policy (confirmed with the designer)

`create_or_open_project({ path })` when the Runtime is already bound to a
**different** project → **fail closed** (`project_mismatch`), no switch. The
designer's `POST /api/project/bind` keeps switching freely (folder-picker path).
This makes the issue's "MCP tool 与 HTTP API 对 project mismatch fail-closed"
criterion directly testable in this slice.

## Files

### EDIT — `bin/ikran-mcp.mjs` (the MCP stdio server Cursor/Codex spawns)

Keep it plain JS ESM. Keep the existing `open_workbench` tool and all stdout
discipline / lifecycle / cleanup. Add:

- A shared `ensureRuntime()` helper that calls `openWorkbench({ stateDir, host,
  prod, cwd: appDir, nextDistDir, extraEnv: {}, timeoutMs: 60_000 })` and
  updates the module-level `lastResult` / `spawnedChild` (and wires child
  stdout-drain / stderr-forward) when it spawns, so cleanup stays correct across
  both tools. Returns `{ host, port, token, url, spawned }`.
- Two small HTTP helpers `apiGet(port, token, route)` and `apiPost(port, token,
  route, body)` using global `fetch` against `http://${host}:${port}${route}`
  with headers `{ host: \`${host}:${port}\`, "x-ikran-session": token }` (and
  `Content-Type: application/json` for POST). Server-side `fetch` sends no
  `Origin` header, so `authorize()`'s same-origin check is skipped and the
  localhost-Host + valid-session checks pass. Always parse JSON; return
  `{ status, body }`.
- Refactor the existing `open_workbench` handler to use `ensureRuntime()` (no
  behavior change).
- A canonical-path compare helper `samePath(a, b)` →
  `path.resolve(a) === path.resolve(b)` (the HTTP side already resolves paths in
  `bindProjectFolder`, so both sides are absolute before compare).
- Register `create_or_open_project` with `inputSchema: { path: z.string().optional() }`
  (`z` from the `zod` dep, already a project dependency + an SDK dep). The
  callback receives `(args)` with `args.path: string | undefined`. Tool
  description must state: binds or opens the project/session, initializes `.ikran/`,
  fails closed if the Runtime is bound to a different project, and that all
  research source-of-truth changes go through Ikran tools. Return
  `{ content: [{type:"text", text}], structuredContent }` where `structuredContent`
  carries `ok`, `project`, `events?`, `active_project`, `connected_agent?`,
  `cwd_candidate?`, `session`, `workbench_url` (and `error` /
  `expected` / `active` on mismatch). Wrap the handler in try/catch and return a
  structured `{ ok:false, error:"runtime_unavailable", detail }` if `ensureRuntime`
  or the HTTP call fails (never throw out of an MCP handler).
- Update the file header + the `instructions` string to mention
  `create_or_open_project` alongside `open_workbench` (do not describe the full
  tool boundary — that is 02/03).

### NEW — `tests/project-session-mcp.spec.ts` (e2e: the real Agent project path through MCP)

Do NOT use the `runtime` fixture (the MCP server spawns its own Next). Per-test
temp `stateDir` (`mkdtempSync`) + temp project folders. Use the MCP SDK client
over `StdioClientTransport` exactly like `tests/open-workbench-mcp.spec.ts`
(`--prod`, `IKRAN_STATE_DIR`, `IKRAN_NEXT_DIST_DIR=SHARED_BUILD_DIR`,
`stderr:"pipe"`). Generous timeout (e.g. `test.setTimeout(120_000)`). Cover:

1. `listTools()` includes both `open_workbench` and `create_or_open_project`.
2. `create_or_open_project({ path: dirA })` (no active) → CREATE: assert
   `structuredContent.ok === true`, `project.path` (resolved) === dirA, `events`
   has `project_created` + `folder_selected`, `session` + `workbench_url` present.
   Assert `dirA/.ikran/config.json`, `dirA/.ikran/ikran.db`, `dirA/.ikran/events.jsonl`
   exist; SQLite `events` table has ≥2 rows; events.jsonl contains
   `project_created` + `folder_selected`.
3. `create_or_open_project({ path: dirA })` again → OPEN idempotent: `ok === true`,
   `project.path === dirA`.
4. `create_or_open_project({ path: dirB })` → **FAIL CLOSED**: `ok === false`,
   `error === "project_mismatch"`, `expected` (resolved) === dirB, `active` ===
   dirA. Assert `dirB/.ikran` was NOT created (no silent bind).
5. `create_or_open_project({})` (no path) → OPEN current: `ok === true`,
   `project.path === dirA`, `session` present.
6. HTTP-side switch still works + MCP follows: direct `fetch` `POST /api/project/bind`
   `{ path: dirB }` with the token → 200, `project.path === dirB`. Then
   `create_or_open_project({ path: dirB })` → OPEN (active==path, `ok === true`).
   Then `create_or_open_project({ path: dirA })` → `project_mismatch` (active is
   now dirB). Proves MCP and HTTP share the same binding.
7. No-token enforcement at the HTTP boundary: `fetch GET /api/project` (no token) →
   403; `fetch POST /api/project/bind` (no token) → 403.
8. Refresh recovery through an MCP-initiated binding: `page.goto(workbench_url)`
   from step 6 (active = dirB) → assert shell renders + `Local runtime connected`;
   `page.reload()` → assert `folder-helper` contains `Complete! {dirB}` and
   `project-path === dirB` (the UI recovers the binding the Agent set).
9. Cleanup: `client.close()`, `killRecordedRuntime(stateDir)` (reuse the helper
   pattern from open-workbench-mcp.spec.ts), `rmSync` temp dirs + stateDir.

### NEW — `docs/manual-agent-smoke-issue02.md` (set up + guidance for the user's manual Agent test)

The user does the real-Agent validation; we only set up + guide. Mirror the
structure of `docs/manual-agent-smoke-issue01.md` but for the project-binding
flow. Include:

1. Build once (optional, for `--prod`) / recommended `npm start` flow.
2. Cursor/Codex MCP config (same `bin/ikran-mcp.mjs`, `--prod`, absolute path,
   `IKRAN_HOST`). Note the server now also exposes `create_or_open_project`.
3. The real-Agent flow: ask the Agent to "open Ikran and bind the project at
   `<empty folder>`" (or "create or open the Ikran project for `<folder>`").
   Expect `open_workbench` → Workbench URL, then `create_or_open_project({ path })`
   → project bound. Open the URL, confirm the setup card shows the bound folder
   (`Complete! <path>`).
4. "See the same project/session": ask the Agent to "show the current Ikran
   project/session". Expect `create_or_open_project({})` (or the Agent's
   equivalent) returning the same project path + session.
5. Mismatch check: ask the Agent to bind a *different* folder while one is
   active. Expect `project_mismatch` (fail-closed). Record whether the Agent
   surfaced this cleanly or as an open gap.
6. Bad-token `curl` on `/api/project` (no token → 403, real token → 200) — proves
   session enforcement covers the project surface.
7. Codex Desktop: try the same; if tool discovery fails, record the open gap +
   fallback (bind via the UI / the printed URL).
8. Smoke log template (fill in under `.plans/issue02-02/`).
9. Localhost-only reminder.

## Acceptance criteria mapping (Issue 02/02)

| Criterion | How met |
| --- | --- |
| Workbench binds a local project folder and initializes `.ikran/` | existing `bindProjectFolder` (HTTP + now MCP via proxy); e2e asserts `.ikran/config.json` + `ikran.db` + `events.jsonl`. |
| Runtime records `project_created` / `folder_selected` events | existing `logEvent`; e2e asserts events in SQLite + jsonl for an MCP-initiated bind. |
| Refresh Workbench recovers current project/session state | existing `ProjectSetupCard` recovery; new e2e reloads after an MCP bind and asserts the bound folder is recovered. |
| MCP tool 与 HTTP API 对 project mismatch fail-closed | `create_or_open_project` returns `project_mismatch` when active ≠ path; e2e asserts it + that no `.ikran` is created on the rejected path. HTTP side already 409 via `/api/agent/connect`. |
| `.ikran` contains at least SQLite init + event log basis | existing `db.ts` + `events.ts`; e2e asserts the SQLite `events` table + `events.jsonl`. |
| Tests cover binding, recovery, project mismatch, no token | `tests/project-session-mcp.spec.ts` covers all four; existing `project-folder-binding.spec.ts` covers the HTTP path. |
| Real Agent validation (Agent opens URL, guides bind, sees same project/session) | `docs/manual-agent-smoke-issue02.md` set up + guidance; user performs manually. |

## Non-goals (do NOT do in this slice)

- The rest of the semantic MCP tool boundary (`register_seed_reference`,
  `record_evidence_package`, `create_region_annotation`, …) + the mock MCP
  client — that is Issue 02/03.
- One-process custom Next server consolidation — Issue 02/03.
- Changing the HTTP `/api/project/bind` switch behavior (the designer's
  folder-picker path stays free-to-switch) — the existing test depends on it.
- Any Figma contact by Runtime — never.
- A speculative `artifacts` SQLite table (the acceptance only requires SQLite +
  event-log basis; the real artifact index is Issue 02/08). Do not add it.
- UI/visual changes to `ProjectSetupCard` — Figma-owned; do not alter
  layout/copy/icons/styling (per `AGENTS.md`).

## Verification gate (must pass before claiming done)

1. `npm run typecheck` → 0 errors.
2. `npx playwright test tests/project-session-mcp.spec.ts tests/project-folder-binding.spec.ts tests/open-workbench-mcp.spec.ts`
   → all green (global-setup builds once; then the three specs).
3. If any fail, fix and re-run until green. Do not leave failing tests.
4. Quick manual sanity: `node bin/ikran-mcp.mjs --prod` lists
   `create_or_open_project` in `listTools` (the e2e already proves it; this is a
   belt-and-braces check).

## Key existing references (read these)

- `lib/runtime/project.ts`, `lib/runtime/cwd-candidate.ts`, `lib/runtime/paths.ts`,
  `lib/runtime/db.ts`, `lib/runtime/events.ts`, `lib/runtime/session.ts`.
- `app/api/project/route.ts`, `app/api/project/bind/route.ts`,
  `app/api/agent/connect/route.ts`, `app/page.tsx`,
  `components/setup/ProjectSetupCard.tsx`.
- `bin/ikran-mcp.mjs`, `bin/ikran.mjs`, `lib/runtime/runtime-endpoint.mjs`.
- `tests/open-workbench-mcp.spec.ts`, `tests/project-folder-binding.spec.ts`,
  `tests/fixtures.ts`, `tests/e2e-constants.ts`.
- `@modelcontextprotocol/sdk` — `server/mcp.js` `registerTool(name, { description,
  inputSchema? }, cb)`; `inputSchema` accepts a Zod **raw shape**
  (`{ path: z.string().optional() }`); the callback receives `(args, extra)` with
  `args` parsed against the shape. `structuredContent` is returned without
  `outputSchema` (matches the existing `open_workbench` tool).