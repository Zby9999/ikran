# Runtime lib inventory — `lib/runtime/*`

Source: full read of 8 files in `lib/runtime/` on 2026-07-03.
Codebase: Ikran local-first workbench (Next.js + TypeScript, better-sqlite3).

> ⚠️ **HEADLINE DISCREPANCY for the task-runner design.** The inventory brief
> says *"events.ts: the EventEmitter bus — its export name, channel/event
> names, subscribe/emit API … task progress must flow through THIS bus."*
> **There is no EventEmitter bus in `events.ts`.** The module is purely a
> *write-once durable log* (SQLite `events` table + `.ikran/events.jsonl`
> append) plus a *read* helper. There is no `EventEmitter`, no `subscribe`,
> no `emit`, no in-process channel, and no SSE bridge. Any task-runner that
> needs live progress streaming must **add** a bus (or build SSE on top of
> `logEvent`/`listEvents` polling). See §2.

---

## 0. Cross-cutting facts

- **Runtime shape:** single local Next.js server, binds `127.0.0.1` only
  (`config.ts` `HOST`). The `/api/*` surface is the Runtime API, same-origin.
- **Per-project state** lives under `{projectPath}/.ikran/` (`paths.ts`):
  - `config.json` — `ProjectConfig`
  - `ikran.db` — better-sqlite3 database (per-project, NOT shared)
  - `events.jsonl` — append-only event log
  - `artifacts/`, `export/` — output dirs
- **Runtime-global state** lives under `~/.ikran/runtime-state.json`
  (`paths.ts` `RUNTIME_STATE_DIR` / `RUNTIME_STATE_FILE`) and holds only the
  active-project pointer.
- **SQLite driver:** `better-sqlite3` (synchronous). A **fresh connection is
  opened per call** (`openProjectDb` → `closeProjectDb`); there is no
  long-lived/shared DB handle. This is intentional so recreated project
  folders / test resets work cleanly.
- **Module-level mutable state across the 8 files:** essentially none in the
  problematic sense. The only mutable global is
  `globalThis.__IKRAN_SESSION_TOKEN` in `session.ts` (lives on globalThis so
  it survives Next.js HMR module reloads within one process; a fresh process
  gets a fresh token). Everything else is `const`/pure.

---

## 1. `session.ts` — startup-level local session token + same-origin auth

**Purpose:** Generate one session token per Runtime process startup, exposed
only to same-origin Browser UI; enforce localhost Host + same-origin Origin +
valid token on every privileged `/api/*` call. DO NOT propose changes here
(per task brief) — document only.

**Exports (exact signatures):**
```ts
export function getSessionToken(): string
export function isValidSession(value: string | null | undefined): boolean
export function authorize(request: NextRequest): AuthResult
export type AuthResult =
  | { ok: true }
  | { ok: false; status: number; reason: string }
```

**Key types:** `AuthResult` (discriminated union above).

**Mechanics:**
- Token: `randomBytes(32).toString("hex")`, cached on
  `globalThis.__IKRAN_SESSION_TOKEN` (the `GLOBAL` alias). Stable across HMR;
  fresh per process.
- `authorize(request)`:
  1. Reads `host` header; fails `{ok:false, status:403, reason:"missing_host"|"invalid_host"}`.
  2. Parses hostname, requires `isLocalhostHostname(hostname)` (from `config.ts`) — else `reason:"nonlocal_host"`.
  3. If `Origin` header present, requires its origin to match the request origin — else `reason:"cross_origin"` (`"invalid_origin"` on parse failure).
  4. Requires valid session from **either** `x-ikran-session` header **or** `?session=` query param (`request.nextUrl.searchParams.get("session")`) — else `reason:"invalid_session"`.
  5. Returns `{ok:true}` only if all pass.

**SQLite/JSONL/EventEmitter:** none.

**Module-level mutable state:** `globalThis.__IKRAN_SESSION_TOKEN` (via the
`GLOBAL` alias) — the one mutable global in the runtime lib.

> Note on "runtime='nodejs'": there is no literal `runtime = "nodejs"` string
> in `session.ts`. The file imports `node:crypto` and `NextRequest`, so it is
> implicitly Node-runtime (not Edge). The "nodejs runtime pattern" the brief
> refers to is the Next.js route-level `export const runtime = "nodejs"`
> config that consumers of `authorize()` must set on their route handlers
> (since `better-sqlite3` and `node:crypto` require the Node.js runtime).
> `authorize()` itself is just a function; the route file owns the runtime
> declaration.

**Consumer pattern every `/api/*` route must follow:**
```ts
import { authorize } from "@/lib/runtime/session";
export const runtime = "nodejs";             // route file owns this
export async function GET(req: NextRequest) {
  const auth = authorize(req);
  if (!auth.ok) return Response.json({ error: auth.reason }, { status: auth.status });
  // …
}
```

---

## 2. `events.ts` — semantic event log (NOT a bus) ⚠️

**Purpose:** Durably record semantic events in **two** places — SQLite
`events` table (fast query) and `.ikran/events.jsonl` (portable export).
Low-level UI noise (pan/zoom/keystrokes) is intentionally NOT logged.

**Exports (exact signatures):**
```ts
export type EventType =
  | "project_created" | "folder_selected" | "agent_task_started"
  | "figma_evidence_package_returned" | "annotation_created"
  | "question_card_created" | "designer_answer_submitted"
  | "seed_extraction_stage_completed" | "draft_design_system_generated"
  | "design_system_view_generated" | "seed_reconstruction_started"
  | "preview_started" | "new_prototype_run_created"
  | "rule_update_proposal_created" | "rule_update_confirmed"
  | "rule_update_canceled" | "export_generated"
  | "invalid_output" | "repaired_output";

export interface EventPayload { [key: string]: unknown }
export interface LoggedEvent {
  event_id: string; type: EventType; payload: EventPayload; created_at: string;
}

export function logEvent(
  projectPath: string,
  type: EventType,
  payload?: EventPayload
): LoggedEvent

export function listEvents(
  projectPath: string,
  type?: EventType
): LoggedEvent[]
```

**Key types:** `EventType` (19 string literals above), `EventPayload` (open
record), `LoggedEvent`.

**SQLite usage:** opens via `openProjectDb(projectPath)`, runs a prepared
`INSERT INTO events … ON CONFLICT(event_id) DO NOTHING`, closes via
`closeProjectDb` in a `finally`. `listEvents` does `SELECT * FROM events
[WHERE type = ?] ORDER BY created_at ASC`.

**JSONL usage:** `appendFileSync(getProjectEventsPath(projectPath), JSON.stringify(event)+"\n")` — one line per event, after the SQLite write. No rotation, no locking.

**EventEmitter usage:** **NONE.** No `import { EventEmitter }`, no
`.on()`/`.emit()`, no subscriber registry, no in-memory channel. This module
is fire-and-forget durable storage, **not** a pub/sub bus.

**Module-level mutable state:** none.

### Critical implication for the task-runner / `/api/events` SSE design
- **There is nothing to subscribe to today.** `logEvent` writes to disk and
  returns; it does not notify anyone.
- `EventType` already includes `"agent_task_started"` — a task-runner can
  reuse this channel name, but task *progress* (stage/stage-complete,
  heartbeat, completion, error) has **no** existing event types. New
  `EventType` literals would need to be added (e.g. `agent_task_progress`,
  `agent_task_completed`, `agent_task_failed`) — see §3 for the migration
  story.
- A live-progress design has two viable shapes:
  1. **Add an EventEmitter bus** to `events.ts` (or a sibling module) that
     `logEvent` emits to after the durable write, and have `/api/events` SSE
     subscribe + replay recent `listEvents` on connect. (Matches the brief's
     "task progress must flow through THIS bus" intent — but the bus must be
     built first.)
  2. **Polling-only SSE**: `/api/events` tails `events.jsonl` or polls
     `listEvents` with a cursor. Simpler, no new state, but higher latency.
- Either way, **the bus does not exist yet** and must be created. This is the
  single most important fact for the task-runner design.

---

## 3. `db.ts` — per-project SQLite (better-sqlite3)

**Purpose:** Own the `.ikran/ikran.db` connection + schema for one project.
Fresh connection per call so recreated folders/test resets work.

**Exports (exact signatures):**
```ts
export function openProjectDb(projectPath: string): DatabaseType
export function closeProjectDb(db: DatabaseType): void
export function initializeProjectDb(projectPath: string): void
```
(`DatabaseType` = `import type { Database } from "better-sqlite3"`.)

**Driver:** `better-sqlite3` (synchronous, native binding → requires Node.js
runtime, NOT Edge).

**Schema (single `SCHEMA` string, applied verbatim on every open):**
```sql
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,        -- JSON string
  created_at TEXT NOT NULL       -- ISO 8601
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
```

**Migration approach:** **Idempotent `CREATE TABLE IF NOT EXISTS` on every
`openProjectDb()`.** There is **no migration runner, no schema version
table, no `user_version` pragma, no ALTER path**. Adding a table/column
means editing the `SCHEMA` string with another `IF NOT EXISTS` guard. There
is no mechanism yet for adding columns to an *existing* table (a real
migration would need `ALTER TABLE … ADD COLUMN` + version tracking).

**Connection lifecycle:** `openProjectDb` → `new Database(path)` →
`db.exec(SCHEMA)` → `db.pragma("journal_mode = WAL")` → returns. Caller
MUST `closeProjectDb(db)` (swallows close errors). `initializeProjectDb` is
the safe one-shot wrapper (open + close) used by `bindProjectFolder` so no
handle leaks.

**Existing tables:** `events`, `projects`. (Note: the `projects` table is
declared in the schema but **not written/read anywhere in the runtime lib** —
project metadata actually lives in `.ikran/config.json` via `project.ts`.
The SQLite `projects` row is currently unused; do not assume it is
populated.)

**EventEmitter/JSONL:** none here (this module is SQLite-only).

**Module-level mutable state:** none. The `SCHEMA` string is a `const`.

### Implication for task-runner design
- A `tasks` (or `task_runs`) table must be added to the `SCHEMA` string with
  `CREATE TABLE IF NOT EXISTS`. Because there's no migration runner, this is
  safe for new projects but **won't add columns to existing project DBs** —
  if a task table needs to evolve, a real migration story (schema version +
  ALTER) becomes necessary. For issue3, prefer additive `IF NOT EXISTS`
  tables and keep columns stable.
- Every DB access must follow the open→use→`closeProjectDb` pattern (or use
  `initializeProjectDb` for one-shots). Never hold a long-lived handle.

---

## 4. `project.ts` — project folder lifecycle + active-project pointer

**Purpose:** Validate/bind project folders, create `.ikran/` metadata, init
SQLite, log `project_created`+`folder_selected`, and track the
Runtime-global active project via `~/.ikran/runtime-state.json`.

**Exports (exact signatures):**
```ts
export interface ProjectConfig {
  path: string; name: string; created_at: string; updated_at: string;
}
export interface RuntimeState { active_project?: string; last_updated?: string }
export interface ValidationResult { ok: true }
export interface ValidationError { ok: false; reason: string }
export type ValidationResponse = ValidationResult | ValidationError
export interface BindResult {
  ok: true; config: ProjectConfig;
  events: { project_created: string; folder_selected: string };
}
export interface BindError { ok: false; reason: string }
export type BindResponse = BindResult | BindError

export async function validateProjectFolder(folderPath: string): Promise<ValidationResponse>
export function isProjectFolder(folderPath: string): boolean
export async function bindProjectFolder(folderPath: string): Promise<BindResponse>
export function getActiveProject(): string | null
export function setActiveProject(folderPath: string): void
export function loadProjectConfig(folderPath: string): ProjectConfig | null
export function getActiveProjectState(): { ok: true; project: ProjectConfig } | { ok: false; reason: string }
```

**ProjectConfig shape:** `{ path: string; name: string; created_at: string; updated_at: string }` — stored at `.ikran/config.json`.

**Active-project tracking:** `~/.ikran/runtime-state.json` → `RuntimeState =
{ active_project?: string; last_updated?: string }`. `getActiveProject()`
reads it and re-checks `isProjectFolder` (returns `null` if missing/stale).
`setActiveProject(path)` writes it (called by `bindProjectFolder`).
`getActiveProjectState()` is the combined "give me the active ProjectConfig
or a reason" helper used by API routes.

**`bindProjectFolder` flow:** validate → mkdir `.ikran`/`artifacts`/`export`
→ build `ProjectConfig` (preserve `created_at` if config.json already
exists) → write `config.json` → `initializeProjectDb` (SQLite schema) →
`logEvent("project_created")` + `logEvent("folder_selected")` →
`setActiveProject` → return `{ok:true, config, events:{…event_ids}}`.

**SQLite/JSONL/EventEmitter:** uses `initializeProjectDb` (SQLite) and
`logEvent` (SQLite+JSONL). No EventEmitter. `update_at` is written once at
bind time; there is no `touchProjectConfig`/update helper yet.

**Module-level mutable state:** none.

### Implication for task-runner design
- A task-runner should resolve the project via `getActiveProjectState()` (or
  accept an explicit `projectPath`) before reading/writing task DB rows.
- `ProjectConfig` has no `id`; the SQLite `projects.path` UNIQUE column is
  the natural join key if a `tasks` table wants a project FK, but since the
  `projects` table is currently unwritten, prefer storing `project_path`
  directly on task rows (matches the `events` table's denormalized style
  and avoids depending on an unused table).

---

## 5. `paths.ts` — pure path computation

**Purpose:** Compute absolute paths for project-local + runtime-global
state. Functions only compute paths; they never touch the filesystem.

**Exports (exact signatures):**
```ts
export const RUNTIME_STATE_DIR: string    // ~/.ikran
export const RUNTIME_STATE_FILE: string   // ~/.ikran/runtime-state.json
export function getIkranDir(projectPath: string): string                 // {p}/.ikran
export function getProjectConfigPath(projectPath: string): string       // {p}/.ikran/config.json
export function getProjectDbPath(projectPath: string): string           // {p}/.ikran/ikran.db
export function getProjectEventsPath(projectPath: string): string       // {p}/.ikran/events.jsonl
export function getArtifactsDir(projectPath: string): string            // {p}/.ikran/artifacts
export function getExportDir(projectPath: string): string               // {p}/.ikran/export
```

**SQLite/JSONL/EventEmitter:** none (pure helpers).

**Module-level mutable state:** `HOME = homedir()` captured once at module
load (effectively immutable). The two `export const` paths derive from it.

---

## 6. `config.ts` — runtime bind config + localhost allowlist

**Purpose:** Centralize service name, host/port, and the "counts as local"
hostname set used by `session.authorize`.

**Exports (exact signatures):**
```ts
export const SERVICE: string            // "ikran-runtime"
export const HOST: string               // env IKRAN_HOST || "127.0.0.1"
export const PORT: number               // env IKRAN_PORT || 3000
export function isLocalhostHostname(hostname: string): boolean
```

**Localhost allowlist:** `new Set(["localhost", "127.0.0.1", "::1"])` —
anything else (e.g. a DNS-rebinding domain) is rejected fail-closed by
`authorize`.

**SQLite/JSONL/EventEmitter:** none.

**Module-level mutable state:** `LOCALHOST_HOSTNAMES` is a `const Set`
(not reassigned; safe).

---

## 7. `cwd-candidate.ts` — launcher CWD auto-bind decision

**Purpose:** Read `process.env.IKRAN_CWD` (forwarded by the `ikran`
launcher; NOT `process.cwd()`, which is the app package dir) and classify
the folder for auto-bind vs. manual confirm.

**Exports (exact signatures):**
```ts
export type CwdCandidateKind = "resume" | "init" | "manual"
export interface CwdCandidate { path: string; kind: CwdCandidateKind }
export function isAutoBindable(candidate: CwdCandidate): boolean
export async function getCwdCandidate(): Promise<CwdCandidate | null>
```

**Kinds:**
- `"resume"` — `.ikran/config.json` already exists → auto-bind, no confirm.
- `"init"` — folder effectively empty (only `.DS_Store`/`Thumbs.db`) →
  auto-bind, no confirm (writes only `.ikran/`).
- `"manual"` — valid, non-empty, not an Ikran project → do NOT auto-bind;
  UI offers a one-click confirm.

**SQLite/JSONL/EventEmitter:** none (uses `validateProjectFolder` from
`project.ts`).

**Module-level mutable state:** `IGNORED_EMPTY_ENTRIES` is a `const Set`.

---

## 8. `folder-picker.ts` — native OS folder dialog

**Purpose:** Open the system folder dialog from the Runtime (Browser UI
can't). Best-effort platform support; structured `unavailable` fallback so
UI can fall back to manual path input.

**Exports (exact signatures):**
```ts
export type FolderPickerResult =
  | { ok: true; path: string }
  | { ok: false; reason: "cancelled" | "unavailable"; detail?: string }
export function selectFolder(): Promise<FolderPickerResult>
```

**Platform impls:** macOS (AppleScript `choose folder` → AppKit `NSOpenPanel`
fallback), Linux (`zenity --file-selection --directory`), Windows
(PowerShell `FolderBrowserDialog`). Uses `node:child_process.spawn`.

**SQLite/JSONL/EventEmitter:** none.

**Module-level mutable state:** `CANCELLED` is a `const` sentinel string.

---

## Summary table

| File | Core role | SQLite | JSONL | EventEmitter | Mutable module state |
|------|-----------|:------:|:-----:|:------------:|:--------------------:|
| session.ts | startup token + `authorize()` | — | — | — | `globalThis.__IKRAN_SESSION_TOKEN` |
| events.ts | durable event log | ✅ write/read | ✅ append | ❌ **none** | none |
| db.ts | per-project DB connection + schema | ✅ | — | — | none (`SCHEMA` const) |
| project.ts | folder bind + active-project pointer | ✅ via db/events | ✅ via events | — | none |
| paths.ts | pure path computation | — | — | — | `HOME` captured once |
| config.ts | host/port + localhost allowlist | — | — | — | none (`const Set`) |
| cwd-candidate.ts | `IKRAN_CWD` auto-bind classify | — | — | — | none (`const Set`) |
| folder-picker.ts | native OS folder dialog | — | — | — | none (`const` sentinel) |