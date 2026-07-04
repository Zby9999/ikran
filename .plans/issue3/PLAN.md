# Issue 03 — Mocked AgentAdapter 任务闭环: Implementation Plan

> Backend/Runtime/pipeline only. **UI sidebar rendering is DEFERRED** to a
> Figma-driven UI issue (see §8). This plan exposes task status + SSE so the
> UI can consume it later.

Scope: introduce the first `AgentAdapter` boundary (deterministic mock), a
task runner that persists 3-layer state, schema validation at the intake
point (no repair), per-task timeout, isolation, and live progress over the
existing single `/api/events` SSE — plus `GET /api/tasks[/:id]` so a
mid-run refresh rebuilds.

All code is Node-runtime only (`better-sqlite3`, `node:crypto`, `node:events`).
New routes mirror the existing `authorize()` + `export const runtime = "nodejs"`
+ `export const dynamic = "force-dynamic"` pattern. `session.ts` is **not
modified**.

---

## 0. Decisions the constraints left open (justified here, not deviations)

1. **Schema validation lib: add `zod`.** No zod/ajv is installed today; the
   inventory suggested hand-rolled validators. But this plan's task spec
   explicitly asks for "a function returning a zod/ajv schema for that
   family's output," so adding `zod` is the faithful choice. zod gives
   per-family typed schemas + `safeParse` for the pass/fail branch the runner
   needs. The adapter *contract* (`adapter.ts`) only imports `z.ZodTypeAny` as
   a **type**; only the runner + `schemas.ts` use zod at runtime.
2. **JSONL layer = the existing `events.jsonl` via `logEvent`** (not a new
   `tasks.jsonl`). `runtime.md` says "mirror existing events.ts approach."
   Task state *transitions* (started/completed/failed/invalid_output) are
   logged through `logEvent` → SQLite `events` table + `.ikran/events.jsonl`.
   Transient `progress` is bus + SSE only (not durably logged) — it is not a
   state transition.
3. **Stale-running reconciliation happens on READ** (`GET /api/tasks` and
   `GET /api/tasks/[id]`), not on process startup. Justification: the Next.js
   server has no natural "runtime init" hook we can attach to; lazy
   reconcile-on-read guarantees the UI always sees consistent post-restart
   state on the exact path V1 exercises (refresh). It is also trivially
   testable by inserting a fake `running` row with no live handle and hitting
   the list endpoint.
4. **No `AbortSignal` in the payload.** A signal is not serializable across a
   subprocess boundary, so putting one in `TaskPayload` would violate
   constraint #2. Cancellation is expressed **only** through the
   `AsyncIterable` protocol (`iterator.return()`); a future CLI adapter
   implements `return()` to kill its subprocess.
5. **Module-level runtime state (live-handle Map, EventEmitter bus) is stashed
   on `globalThis`** exactly like `session.ts`'s token, so it survives Next.js
   dev HMR. This is runtime-side infrastructure, **not** adapter state — the
   adapter contract (constraint #2) still forbids adapters from touching it.

**No deviations from the 8 hard constraints.** (See §9.)

---

## 1. Adapter boundary — `lib/runtime/adapter.ts` (NEW)

Exact contents:

```ts
// AgentAdapter boundary — the stable contract between Ikran Runtime and any
// agent backend (deterministic mock now; headless CLI in Issue 14).
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ HARD CONSTRAINT (do not silently deviate): this interface MUST NOT       │
// │ couple to in-process internals. Concretely:                             │
// │   • Do NOT require()/import project files from inside an adapter.       │
// │   • Do NOT read or write module-level mutable shared state.             │
// │   • The TaskPayload passed to run() MUST stay serializable: no          │
// │     AbortSignal, no callbacks, no function values, no live handles.     │
// │     Issue 14's real CLI adapter spawns a SUBPROCESS and marshals the    │
// │     payload over stdin/argv, so anything non-serializable breaks it.    │
// │   • Cancellation is expressed ONLY through the AsyncIterable protocol   │
// │     (iterator.return()). The runner calls return() to cancel; a real    │
// │     adapter implements return() to kill its subprocess. There is no     │
// │     signal in the payload BY DESIGN (a signal is not serializable).     │
// └─────────────────────────────────────────────────────────────────────────┘
//
// run() returns AsyncIterable<AdapterEvent>, NOT a Promise: a Promise can
// only deliver one terminal value, so per-step progress (required by Issue
// 14's long-running CLI) would be impossible. The Runtime consumes the
// async iterable, forwarding progress to the SSE bus and validating the
// final output at the intake/join point only.

import type { ZodTypeAny } from "zod";

// MVP task families — the PRD §"Agent 任务契约" list. This is the POST
// /api/tasks family whitelist.
export type TaskFamily =
  | "project_setup"
  | "generate_seed_alignment_questions"
  | "draft_design_system"
  | "reconstruct_seed_prototype"
  | "generate_design_system_view"
  | "create_new_prototype"
  | "rule_update"
  | "export_research_package";

// ACP-flavored event kinds.
export type AdapterEventKind = "progress" | "output" | "done" | "error";

export interface AdapterEvent {
  kind: AdapterEventKind;
  /** Human-readable status text (mainly "progress"/"error"). */
  message?: string;
  /** Intermediate structured data ("progress"/"output"). */
  data?: unknown;
  /** Final output. Present on "done"; the runner validates it against the
   *  family schema at the intake point. */
  output?: unknown;
  /** Present on "error" (adapter-side failure). */
  error?: { code: string; message: string };
}

/** Mock-adapter control flags. Tests drive these to trigger hang / invalid
 *  output. Real adapters (Issue 14) MUST ignore this field entirely. */
export interface MockControl {
  mode?: "normal" | "hang" | "invalid";
  progressTicks?: number;
  delayMs?: number;
}

/** The serializable payload handed to adapter.run(). `family` is included so
 *  a single adapter instance can be family-aware without external state. */
export interface TaskPayload {
  family: TaskFamily;
  input: unknown;
  /** Mock-only control bag; ignored by real adapters. */
  mock?: MockControl;
}

export type TaskOutput = unknown;

export type TaskErrorCode =
  | "timeout"
  | "invalid_output"
  | "abandoned"
  | "adapter_error";

export interface TaskResult {
  taskId: string;
  family: TaskFamily;
  status: "done" | "failed";
  output?: TaskOutput;
  errorCode?: TaskErrorCode;
  errorMessage?: string;
  startedAt: string;
  finishedAt: string;
}

/** Per-family output schema hook. Returns a zod schema; the runner validates
 *  adapter "done" output against it AT THE INTAKE POINT ONLY (pass → done,
 *  fail → failed + invalid_output). No repair re-feed (Issue 13's job). */
export type OutputSchemaHook = () => ZodTypeAny;

/** The boundary. Implementations: mock (this issue), CLI subprocess (Issue 14). */
export interface AgentAdapter {
  run(payload: TaskPayload): AsyncIterable<AdapterEvent>;
}
```

Why this shape satisfies the constraints:
- `run()` → `AsyncIterable<AdapterEvent>` (constraint #1).
- File header states constraint #2 verbatim and forbids non-serializable
  payloads / shared state / `require` of project files.
- `AdapterEvent.kind` ∈ the 4 ACP kinds (constraint #8).
- `OutputSchemaHook` gives the per-family schema the runner validates at the
  join point (constraint #5).

---

## 2. Mock adapter — `lib/runtime/adapters/mock-adapter.ts` (NEW)

Deterministic, family-aware, test-triggerable. Returns a **fresh** object per
call (constraint #7: no shared mutable state across tasks).

```ts
// Deterministic mock AgentAdapter. Returns fixed JSON per task family so the
// full Browser UI -> Runtime -> Adapter -> SSE path can be exercised with no
// real Figma MCP or external CLI. Test modes are driven by payload.mock.

import type {
  AgentAdapter,
  AdapterEvent,
  TaskFamily,
  TaskPayload
} from "../adapter";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const never = () => new Promise<void>(() => { /* never resolves: hang mode */ });

// Family → deterministic output factory. Fresh object each call (isolation).
const MOCK_OUTPUTS: Record<TaskFamily, () => unknown> = {
  project_setup: () => ({
    projectId: "mock-project-0001",
    steps: ["scaffold", "bind-folder", "init-metadata"]
  }),
  generate_seed_alignment_questions: () => ({
    questions: [
      { id: "q-01", text: "What is the primary user goal?" },
      { id: "q-02", text: "Which platforms are in scope?" },
      { id: "q-03", text: "What is the visual tone?" }
    ]
  }),
  draft_design_system: () => ({
    designSystemId: "ds-mock-0001",
    foundations: { color: { primary: "#0B5FFF" }, typography: { base: "Inter" } },
    components: [
      { id: "btn", name: "Button" },
      { id: "card", name: "Card" }
    ]
  }),
  reconstruct_seed_prototype: () => ({
    prototypeId: "proto-mock-0001",
    files: [
      { path: "index.html", content: "<!doctype html><h1>mock</h1>" },
      { path: "style.css", content: "body{font:Inter}" }
    ]
  }),
  generate_design_system_view: () => ({
    viewId: "dsv-mock-0001",
    foundations: [{ id: "color", tokens: [{ name: "primary", value: "#0B5FFF" }] }],
    components: [{ id: "btn", name: "Button", props: [] }]
  }),
  create_new_prototype: () => ({
    prototypeId: "proto-mock-0002",
    basedOn: null,
    files: [{ path: "index.html", content: "<!doctype html><h1>new mock</h1>" }]
  }),
  rule_update: () => ({
    proposalId: "ru-mock-0001",
    ruleId: "spacing-scale",
    change: "replace 4px base with 8px base",
    rationale: "improve readability at default zoom"
  }),
  export_research_package: () => ({
    exportId: "exp-mock-0001",
    manifest: { files: ["design-system.json", "evidence.md", "questions.json"] },
    format: "json+jsonl"
  })
};

// Output deliberately shaped to FAIL every family schema (triggers
// invalid_output at the intake point without any hack).
const MALFORMED_OUTPUT = Object.freeze({ thisIs: "malformed", missing: true });

export function getMockAdapter(): AgentAdapter {
  return { run };
}

async function* run(payload: TaskPayload): AsyncIterable<AdapterEvent> {
  const mode = payload.mock?.mode ?? "normal";
  const ticks = payload.mock?.progressTicks ?? 3;
  const delay = payload.mock?.delayMs ?? 60;

  yield { kind: "progress", message: `starting ${payload.family}` };

  if (mode === "hang") {
    // Emit one progress tick, then never yield done. The runner's per-task
    // timeout fires → failed/timeout. Generalizes: a real adapter that hangs
    // is killed the same way.
    await sleep(delay);
    yield { kind: "progress", message: "working (will hang)" };
    await never(); // blocks until runner cancels via iterator.return()
    return;
  }

  for (let i = 1; i <= ticks; i++) {
    await sleep(delay);
    yield { kind: "progress", message: `step ${i}/${ticks}`, data: { step: i } };
  }

  if (mode === "invalid") {
    yield { kind: "output", data: { partial: "malformed" } };
    yield { kind: "done", output: { ...MALFORMED_OUTPUT } };
    return;
  }

  const output = MOCK_OUTPUTS[payload.family]();
  yield { kind: "output", data: output };
  yield { kind: "done", output };
}
```

Notes:
- Natural completion is `~60ms × (ticks+2)` → a few hundred ms (constraint:
  fast for tests). The **runner** default timeout is 30s (constraint #6); tests
  override `timeoutMs` to a small value (e.g. 300ms) for V3.
- `hang` and `invalid` are clean payload flags — no test-only adapter, no
  environment hacks. A real adapter would simply not have a `mock` bag.
- Cancellation: the runner calls `iterator.return()` on timeout/abort. For the
  `hang` case the generator is blocked on `await never()`; `return()` is
  best-effort (may queue until the generator next suspends) — the runner does
  **not** wait for the generator to stop; it finalizes task state in all 3
  layers immediately and drops the handle. The orphaned generator becomes
  unreferenced and is GC'd. See §3.

---

## 3. Task runner — `lib/runtime/task-runner.ts` (NEW)

Owns the in-process live-handle Map, drives the adapter async iterable,
enforces timeout, validates at the join point, emits to the bus, and
persists to SQLite + JSONL.

```ts
// Task runner: bridges the AgentAdapter async iterable to the 3-layer task
// state (SQLite tasks table + in-process live-handle Map + JSONL event log)
// and to the in-process EventEmitter bus that /api/events multiplexes.
//
// Module-level state here (liveHandles) is RUNTIME-side infrastructure, NOT
// adapter state — adapters never touch it (constraint #2). It is stashed on
// globalThis so it survives Next.js dev HMR, mirroring session.ts.

import { randomUUID } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import { openProjectDb, closeProjectDb } from "./db";
import { logEvent } from "./events";
import { emitTaskEvent } from "./task-bus";
import { getMockAdapter } from "./adapters/mock-adapter";
import { familySchemas } from "./schemas";
import type {
  AdapterEvent,
  MockControl,
  TaskFamily,
  TaskErrorCode,
  TaskPayload
} from "./adapter";

export type TaskStatus = "running" | "done" | "failed";

export const DEFAULT_TIMEOUT_MS = 30_000; // constraint #6

export interface LiveHandle {
  taskId: string;
  family: TaskFamily;
  projectPath: string;
  status: TaskStatus;
  iterator: AsyncIterator<AdapterEvent> | null;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  startedAt: string;
}

interface TaskInput {
  input?: unknown;
  mock?: MockControl;
}

interface TaskRow {
  id: string;
  family: string;
  payload_json: string;
  status: string;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// globalThis stash for HMR survival (mirrors session.ts).
const G = globalThis as unknown as { __IKRAN_LIVE_HANDLES?: Map<string, LiveHandle> };
const liveHandles: Map<string, LiveHandle> =
  G.__IKRAN_LIVE_HANDLES ?? (G.__IKRAN_LIVE_HANDLES = new Map());

// ---- public API ----

export function createTask(
  projectPath: string,
  family: TaskFamily,
  input: TaskInput,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): { taskId: string; status: TaskStatus } {
  const taskId = randomUUID();
  const now = new Date().toISOString();
  const payload: TaskPayload = { family, input: input.input, mock: input.mock };

  // Layer 1: SQLite tasks row (running).
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO tasks (id, family, payload_json, status, created_at, updated_at)
       VALUES (?, ?, ?, 'running', ?, ?)`
    ).run(taskId, family, JSON.stringify(payload), now, now);
  } finally {
    closeProjectDb(db);
  }

  // Layer 3: JSONL + SQLite events (started milestone).
  logEvent(projectPath, "agent_task_started", { taskId, family });
  emitTaskEvent({ kind: "started", taskId, family, status: "running", timestamp: now });

  // Layer 2: in-process live handle.
  const iterable = getMockAdapter().run(payload);
  const iterator = iterable[Symbol.asyncIterator]();
  const handle: LiveHandle = {
    taskId, family, projectPath, status: "running",
    iterator, timeoutHandle: null, startedAt: now
  };
  liveHandles.set(taskId, handle);

  // Arm per-task timeout.
  handle.timeoutHandle = setTimeout(() => onTimeout(handle), timeoutMs);

  // Drive the async iterable without awaiting (fire-and-forget).
  void driveIterator(handle);

  return { taskId, status: "running" };
}

export interface TaskView {
  id: string;
  family: TaskFamily;
  status: TaskStatus;
  payload: unknown;
  result: unknown | null;
  errorCode: TaskErrorCode | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  live: boolean; // a live handle exists in this process
}

export function listTasks(projectPath: string): TaskView[] {
  reconcileStaleTasks(projectPath);
  const db = openProjectDb(projectPath);
  try {
    const rows = db
      .prepare("SELECT * FROM tasks ORDER BY created_at ASC")
      .all() as TaskRow[];
    return rows.map(rowToView);
  } finally {
    closeProjectDb(db);
  }
}

export function getTask(projectPath: string, taskId: string): TaskView | null {
  reconcileStaleTasks(projectPath);
  const db = openProjectDb(projectPath);
  try {
    const row = db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(taskId) as TaskRow | undefined;
    return row ? rowToView(row) : null;
  } finally {
    closeProjectDb(db);
  }
}

// Stale-running reconciliation (constraint #4 / V1). On READ, any task whose
// SQLite status is 'running' but has NO live handle (process restarted, or
// HMR dropped the handle) is marked failed/abandoned. Justification in §0.3.
export function reconcileStaleTasks(projectPath: string): void {
  const db = openProjectDb(projectPath);
  try {
    const stale = db
      .prepare("SELECT id, family FROM tasks WHERE status = 'running'")
      .all() as { id: string; family: TaskFamily }[];
    for (const row of stale) {
      if (liveHandles.has(row.id)) continue;
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE tasks SET status='failed', error_code='abandoned',
                error_message='live handle lost (process restart)',
                updated_at=? WHERE id=?`
      ).run(now, row.id);
      logEvent(projectPath, "agent_task_failed", { taskId: row.id, family: row.family, errorCode: "abandoned" });
      emitTaskEvent({ kind: "failed", taskId: row.id, family: row.family, status: "failed", errorCode: "abandoned", timestamp: now });
    }
  } finally {
    closeProjectDb(db);
  }
}

// ---- internal driver ----

async function driveIterator(handle: LiveHandle): Promise<void> {
  const it = handle.iterator;
  if (!it) return;
  try {
    while (true) {
      const { done, value } = await it.next();
      if (done || !value) {
        // Iterator ended without an explicit done event → treat as empty done.
        if (handle.status === "running") finalizeDone(handle, undefined);
        return;
      }
      if (handle.status !== "running") return; // already finalized (timeout)
      switch (value.kind) {
        case "progress":
          emitTaskEvent({
            kind: "progress", taskId: handle.taskId, family: handle.family,
            status: "running", message: value.message, data: value.data,
            timestamp: new Date().toISOString()
          });
          break;
        case "output":
          emitTaskEvent({
            kind: "output", taskId: handle.taskId, family: handle.family,
            status: "running", data: value.data,
            timestamp: new Date().toISOString()
          });
          break;
        case "done":
          await onDone(handle, value.output);
          return;
        case "error":
          onError(handle, value.error?.code ?? "adapter_error", value.error?.message ?? "adapter error");
          return;
      }
    }
  } catch (err) {
    if (handle.status === "running") {
      onError(handle, "adapter_error", err instanceof Error ? err.message : String(err));
    }
  }
}

// Join-point validation (constraint #5): pass → done, fail → failed + invalid_output. NO repair.
async function onDone(handle: LiveHandle, output: unknown): Promise<void> {
  const schema = familySchemas[handle.family]();
  const parsed = schema.safeParse(output);
  if (parsed.success) {
    finalizeDone(handle, parsed.data);
  } else {
    const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    finalizeFailed(handle, "invalid_output", message);
    logEvent(handle.projectPath, "invalid_output", { taskId: handle.taskId, family: handle.family, errors: message });
    // Intentionally NO repaired_output / NO re-feed. Issue 13 owns the one-repair loop.
  }
}

function onError(handle: LiveHandle, code: TaskErrorCode, message: string): void {
  finalizeFailed(handle, code, message);
}

function onTimeout(handle: LiveHandle): void {
  if (handle.status !== "running") return;
  handle.timeoutHandle = null;
  // Best-effort cooperative cancel via the AsyncIterable protocol (constraint #2:
  // no AbortSignal in the payload). The runner does NOT wait for the generator.
  try { void handle.iterator?.return?.(); } catch { /* ignore */ }
  finalizeFailed(handle, "timeout", `task exceeded ${DEFAULT_TIMEOUT_MS /* see note */}ms`);
}

function finalizeDone(handle: LiveHandle, output: unknown): void {
  if (handle.status !== "running") return;
  clearTimer(handle);
  const now = new Date().toISOString();
  handle.status = "done";
  liveHandles.delete(handle.taskId);
  const db = openProjectDb(handle.projectPath);
  try {
    db.prepare(
      `UPDATE tasks SET status='done', result_json=?, updated_at=? WHERE id=?`
    ).run(JSON.stringify(output ?? null), now, handle.taskId);
  } finally {
    closeProjectDb(db);
  }
  logEvent(handle.projectPath, "agent_task_completed", { taskId: handle.taskId, family: handle.family });
  emitTaskEvent({ kind: "completed", taskId: handle.taskId, family: handle.family, status: "done", output, timestamp: now });
}

function finalizeFailed(handle: LiveHandle, code: TaskErrorCode, message: string): void {
  if (handle.status !== "running") return;
  clearTimer(handle);
  const now = new Date().toISOString();
  handle.status = "failed";
  liveHandles.delete(handle.taskId);
  const db = openProjectDb(handle.projectPath);
  try {
    db.prepare(
      `UPDATE tasks SET status='failed', error_code=?, error_message=?, updated_at=? WHERE id=?`
    ).run(code, message, now, handle.taskId);
  } finally {
    closeProjectDb(db);
  }
  logEvent(handle.projectPath, "agent_task_failed", { taskId: handle.taskId, family: handle.family, errorCode: code });
  emitTaskEvent({ kind: "failed", taskId: handle.taskId, family: handle.family, status: "failed", errorCode: code, errorMessage: message, timestamp: now });
}

function clearTimer(handle: LiveHandle): void {
  if (handle.timeoutHandle) {
    clearTimeout(handle.timeoutHandle);
    handle.timeoutHandle = null;
  }
}

function rowToView(row: TaskRow): TaskView {
  return {
    id: row.id,
    family: row.family as TaskFamily,
    status: row.status as TaskStatus,
    payload: safeParse(row.payload_json),
    result: row.result_json ? safeParse(row.result_json) : null,
    errorCode: row.error_code as TaskErrorCode | null,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    live: liveHandles.has(row.id)
  };
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
```

> **Note on `onTimeout`'s message:** it should record the *actual* configured
> timeout, not the constant. Implementation detail: capture `timeoutMs` on the
> `LiveHandle` (add `timeoutMs: number` to the interface) and use
> `handle.timeoutMs` in the message. Shown inline-constant here only for
> brevity; the executor must store `timeoutMs` on the handle.

Per-task isolation (constraint #7): every task gets its own `taskId`, its own
`LiveHandle`, its own `iterator`, its own `setTimeout`, and its own SQLite row.
The mock returns fresh objects per call. No shared mutable state crosses tasks.
The `liveHandles` Map is keyed by `taskId` and only mutated by the owning
task's driver/timeout callbacks.

Restart behavior (constraint #4 / V1): on the next `GET /api/tasks` or
`GET /api/tasks/[id]`, `reconcileStaleTasks` marks every `running` row with no
live handle as `failed`/`abandoned` and emits + logs `agent_task_failed`. This
is the chosen "pick one" answer (justified §0.3).

---

## 4. Task state — 3 layers

### Layer 1 — SQLite `tasks` table (modify `lib/runtime/db.ts`)

Add to the existing `SCHEMA` string (additive `CREATE TABLE IF NOT EXISTS`,
mirroring the current no-migration approach). Exact DDL:

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,          -- UUID (randomUUID)
  family        TEXT NOT NULL,             -- TaskFamily whitelist value
  payload_json  TEXT NOT NULL,             -- JSON.stringified TaskPayload
  status        TEXT NOT NULL,             -- 'running' | 'done' | 'failed'
  result_json   TEXT,                      -- JSON.stringified validated output (done only)
  error_code    TEXT,                      -- 'timeout' | 'invalid_output' | 'abandoned' | 'adapter_error' (failed only)
  error_message TEXT,
  created_at    TEXT NOT NULL,             -- ISO 8601
  updated_at    TEXT NOT NULL              -- ISO 8601
);
CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_family     ON tasks(family);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
```

Goes **into the existing `SCHEMA` const in `lib/runtime/db.ts`** (after the
`projects` block, before the indexes — keep all `CREATE INDEX` together). No
new migration file; the module already does `db.exec(SCHEMA)` on every
`openProjectDb()`, so new project DBs get the table immediately and existing
DBs get it on next open (additive `IF NOT EXISTS` is safe). Every access uses
the existing `openProjectDb` → use → `closeProjectDb` pattern (no long-lived
handle).

### Layer 2 — In-process live-handle Map

`liveHandles: Map<string, LiveHandle>` in `lib/runtime/task-runner.ts`,
stashed on `globalThis` for HMR survival (§3). Running tasks only; entries are
removed on `done`/`failed`/`timeout`.

### Layer 3 — JSONL event log

Reuse `logEvent()` from `lib/runtime/events.ts` → appends to
`.ikran/events.jsonl` and inserts into the SQLite `events` table. The runner
logs the state-transition milestones: `agent_task_started`,
`agent_task_completed`, `agent_task_failed`, `invalid_output`. (Progress is
bus + SSE only.) This mirrors the existing events.ts path/format exactly, per
`runtime.md`.

> **Modify `lib/runtime/events.ts`:** add two literals to the `EventType`
> union — `"agent_task_completed"` and `"agent_task_failed"` — so the runner
> can log task completion/failure milestones. (`agent_task_started` and
> `invalid_output` already exist.) Add them alphabetically-ish near
> `agent_task_started`.

---

## 5. Routes (NEW; mirror `authorize()` + `runtime="nodejs"` + `dynamic="force-dynamic"`)

All routes use `NextResponse.json` for JSON (like `bind/route.ts`), set
`export const runtime = "nodejs"; export const dynamic = "force-dynamic";`,
call `authorize(request)` first, and return
`NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status })`
on 403. `session.ts` is **not touched**.

### `app/api/tasks/route.ts` (NEW) — POST create + GET list

```ts
// POST /api/tasks  — create + start a task.
// GET  /api/tasks  — list all tasks (refresh rebuild source).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import { getActiveProjectState } from "../../../lib/runtime/project";
import { createTask, listTasks } from "../../../lib/runtime/task-runner";
import type { TaskFamily } from "../../../lib/runtime/adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAMILY_WHITELIST: ReadonlySet<TaskFamily> = new Set<TaskFamily>([
  "project_setup",
  "generate_seed_alignment_questions",
  "draft_design_system",
  "reconstruct_seed_prototype",
  "generate_design_system_view",
  "create_new_prototype",
  "rule_update",
  "export_research_package"
]);

export async function GET(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status });

  const state = getActiveProjectState();
  if (!state.ok) return NextResponse.json({ ok: true, tasks: [] }); // nothing bound yet
  const tasks = listTasks(state.project.path);
  return NextResponse.json({ ok: true, tasks });
}

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status });

  let body: { family?: string; payload?: { input?: unknown; mock?: unknown }; timeoutMs?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const family = body.family as TaskFamily;
  if (!family || !FAMILY_WHITELIST.has(family)) {
    return NextResponse.json({ ok: false, error: "unknown_family" }, { status: 400 });
  }
  if (!body.payload || typeof body.payload !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const state = getActiveProjectState();
  if (!state.ok) {
    return NextResponse.json({ ok: false, error: state.reason }, { status: 400 });
  }

  const timeoutMs =
    typeof body.timeoutMs === "number" && body.timeoutMs > 0 ? body.timeoutMs : undefined;

  const created = createTask(
    state.project.path,
    family,
    { input: body.payload.input, mock: body.payload.mock as never },
    timeoutMs
  );

  return NextResponse.json({ ok: true, taskId: created.taskId, status: created.status }, { status: 201 });
}
```

- **Family whitelist** = the 8 PRD families (the `FAMILY_WHITELIST` set above).
- POST returns `{ ok: true, taskId, status }` (201). Unknown family → 400
  `unknown_family`. Bad payload → 400 `invalid_payload`. No active project →
  400 `no_active_project` (passthrough of `state.reason`).
- GET returns `{ ok: true, tasks: TaskView[] }` (200), empty array if no
  project bound. Calls `listTasks` which reconciles stale tasks first.

### `app/api/tasks/[id]/route.ts` (NEW) — GET one task

Next.js 16 → `params` is a `Promise`:

```ts
// GET /api/tasks/[id] — one task detail (refresh rebuild source).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../../lib/runtime/session";
import { getActiveProjectState } from "../../../../lib/runtime/project";
import { getTask } from "../../../../lib/runtime/task-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authorize(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status });

  const { id } = await params;
  const state = getActiveProjectState();
  if (!state.ok) return NextResponse.json({ ok: false, error: state.reason }, { status: 400 });

  const task = getTask(state.project.path, id);
  if (!task) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, task });
}
```

`getTask` reconciles that task if stale (no live handle but status `running`
→ `abandoned`) before reading. Returns 404 `not_found` if the row is absent.
The `task` object includes `live: boolean` so the UI can tell in-process
running vs. stale.

### `/api/events` change — MINIMAL (modify `app/api/events/route.ts`)

Do **not** add a per-task SSE endpoint or polling. Subscribe the existing
stream to the in-process bus and interleave `event: task` frames alongside
heartbeats. Add optional `?task=<id>` filtering. The current `stop()` only
clears the interval; extend cleanup to **unsubscribe** the bus listener (or
reconnects leak listeners).

Exact additions inside the existing `start(controller)` closure (and
`stop`/`cancel`):

```ts
import { onTaskEvent, type TaskBusEvent } from "../../../lib/runtime/task-bus";

// ... after computing `closed`, before `sendHeartbeat`:
const filterTaskId = request.nextUrl.searchParams.get("task") ?? null;
let unsubscribe: (() => void) | null = null;

const sendTaskEvent = (ev: TaskBusEvent) => {
  if (closed) return;
  if (filterTaskId && ev.taskId !== filterTaskId) return;
  controller.enqueue(
    encoder.encode(`event: task\ndata: ${JSON.stringify(ev)}\n\n`)
  );
};
unsubscribe = onTaskEvent(sendTaskEvent);

// Extend stop() to also unsubscribe:
const stop = () => {
  if (interval) { clearInterval(interval); interval = undefined; }
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
};
```

The existing `cleanup` (on `request.signal` abort) calls `stop()` then
`controller.close()`; the `cancel()` handler also calls `stop()`. Both now
also drop the bus listener. Heartbeat behavior is unchanged. Task frames look
like:

```
event: task
data: {"kind":"started","taskId":"...","family":"draft_design_system","status":"running","timestamp":"..."}

```

---

## 6. SSE — single multiplexed stream (constraint #3)

- **Bus:** new `lib/runtime/task-bus.ts` (see §6a) — an `EventEmitter` stashed
  on `globalThis` (HMR survival), one channel `"task"`.
- **Emitters:** only `task-runner.ts` calls `emitTaskEvent`. Adapters never
  touch the bus (constraint #2).
- **Forwarders:** only `/api/events` subscribes (via `onTaskEvent`) and
  enqueues `event: task` SSE frames. No other SSE endpoint. No polling.
- **Event names on the wire:** `heartbeat` (existing) + `task` (new). The
  `task` frame `data` JSON is the `TaskBusEvent` (fields: `kind ∈
  started|progress|output|completed|failed`, `taskId`, `family`, `status`,
  optional `message`/`data`/`output`/`errorCode`/`errorMessage`, `timestamp`).
- **Filtering:** optional `?task=<id>` query → the route only enqueues events
  whose `taskId` matches. Still one stream; the UI may instead filter
  client-side by `data.taskId`.

### §6a — `lib/runtime/task-bus.ts` (NEW)

```ts
// In-process EventEmitter bus for live task progress. /api/events subscribes
// and multiplexes onto its single SSE stream; task-runner emits. This is
// RUNTIME-side plumbing (not adapter state — adapters never import this).

import { EventEmitter } from "node:events";
import type { TaskFamily, TaskErrorCode, TaskStatus } from "./adapter";

export type TaskBusKind =
  | "started" | "progress" | "output" | "completed" | "failed";

export interface TaskBusEvent {
  kind: TaskBusKind;
  taskId: string;
  family: TaskFamily;
  status: TaskStatus;
  message?: string;
  data?: unknown;
  output?: unknown;
  errorCode?: TaskErrorCode;
  errorMessage?: string;
  timestamp: string;
}

export const TASK_BUS_CHANNEL = "task";

const G = globalThis as unknown as { __IKRAN_TASK_BUS?: EventEmitter };
const bus: EventEmitter =
  G.__IKRAN_TASK_BUS ?? (G.__IKRAN_TASK_BUS = new EventEmitter());
bus.setMaxListeners(0); // many SSE connections may subscribe

export function emitTaskEvent(ev: TaskBusEvent): void {
  bus.emit(TASK_BUS_CHANNEL, ev);
}

export function onTaskEvent(handler: (ev: TaskBusEvent) => void): () => void {
  bus.on(TASK_BUS_CHANNEL, handler);
  return () => bus.off(TASK_BUS_CHANNEL, handler);
}
```

### §6b — `lib/runtime/schemas.ts` (NEW) — per-family zod schema hooks

```ts
import { z } from "zod";
import type { OutputSchemaHook, TaskFamily } from "./adapter";

export const familySchemas: Record<TaskFamily, OutputSchemaHook> = {
  project_setup: () => z.object({
    projectId: z.string(),
    steps: z.array(z.string())
  }),
  generate_seed_alignment_questions: () => z.object({
    questions: z.array(z.object({ id: z.string(), text: z.string() }))
  }),
  draft_design_system: () => z.object({
    designSystemId: z.string(),
    foundations: z.record(z.string(), z.unknown()),
    components: z.array(z.object({ id: z.string(), name: z.string() }))
  }),
  reconstruct_seed_prototype: () => z.object({
    prototypeId: z.string(),
    files: z.array(z.object({ path: z.string(), content: z.string() }))
  }),
  generate_design_system_view: () => z.object({
    viewId: z.string(),
    foundations: z.array(z.unknown()),
    components: z.array(z.unknown())
  }),
  create_new_prototype: () => z.object({
    prototypeId: z.string(),
    basedOn: z.string().nullable(),
    files: z.array(z.object({ path: z.string(), content: z.string() }))
  }),
  rule_update: () => z.object({
    proposalId: z.string(),
    ruleId: z.string(),
    change: z.string(),
    rationale: z.string()
  }),
  export_research_package: () => z.object({
    exportId: z.string(),
    manifest: z.object({ files: z.array(z.string()) }),
    format: z.string()
  })
};
```

Each schema matches the corresponding `MOCK_OUTPUTS` factory in §2, so
`mode: "normal"` passes and `mode: "invalid"` (the `MALFORMED_OUTPUT`) fails
every schema → `invalid_output`.

---

## 7. Tests — `tests/agent-task-runner.spec.ts` (NEW)

Project pattern is **Playwright e2e** (no vitest/jest). `npm run check` =
`tsc --noEmit && playwright test`. Mirror the existing harness in
`tests/project-folder-binding.spec.ts`: `node:http` raw helpers, temp-folder
fixture, `~/.ikran/runtime-state.json` backup/restore, capture the session
token via `page.route("**/api/**", ...)` + `page.goto("/")`. SSE is read with
`page.evaluate` + `new EventSource("/api/events?session=" + token + "&task=" + id)`
(EventSource can't set headers → `?session=` query, per `authorize()`).

Add `zod` to `package.json` dependencies (§8).

The file covers the issue AC end-to-end path **plus** V1–V4. The Browser UI
sidebar AC is DEFERRED, so tests assert at the API + SSE layer (the boundary
the PRD calls highest-value: "浏览器 UI -> Ikran Runtime -> mocked
AgentAdapter -> ... -> SSE result").

Tests (each: one paragraph):

1. **happy path (issue AC: full path)** — Bind a temp folder, `POST /api/tasks`
   with `{ family: "draft_design_system", payload: { input: {} } }`, capture
   `taskId` (201, `{ ok:true, taskId, status:"running" }`). Open an
   `EventSource` for that task and collect frames until a `task` frame with
   `kind:"completed"` arrives. Assert the sequence includes `started` → ≥1
   `progress` → `completed`, the `completed` frame carries the family's
   deterministic `output`, and `GET /api/tasks/[id]` returns
   `status:"done"` + that output. Assert `.ikran/events.jsonl` contains
   `agent_task_started` + `agent_task_completed` rows, and the SQLite `tasks`
   row is `done`.

2. **V1a — mid-run refresh rebuilds (3-layer consistency, same process)** —
   Start a slow mock (`payload: { input: {}, mock: { progressTicks: 6, delayMs:
   120 } }` so it runs ~1s). While it is still running, `GET /api/tasks` →
   that task is `status:"running"`, `live:true`. Simulate a browser refresh by
   re-issuing `GET /api/tasks` and re-opening the `EventSource`; assert the
   status is still `running`, `live:true`, the SSE stream resumes and still
   delivers the eventual `completed`. Assert SQLite (`status='running'` mid-run,
   `done` after), the live handle Map membership (via the `live` flag), and
   `events.jsonl` all agree at each point. This proves refresh rebuilds from
   the 3 layers without losing the in-flight task.

3. **V1b — stale-running reconciled to abandoned on read** — Bind a temp
   folder, then directly insert a fake `running` task row into
   `${testFolder}/.ikran/ikran.db` (no live handle, using `better-sqlite3`
   in-test like the existing suite does). `GET /api/tasks` → that task is now
   `status:"failed"`, `errorCode:"abandoned"`. Assert `events.jsonl` gained an
   `agent_task_failed` event with `errorCode:"abandoned"`. This proves the
   restart-reconciliation path (constraint #4 / §0.3).

4. **V2 — two concurrent tasks don't cross-talk (isolation)** — Start two
   tasks concurrently: `draft_design_system` and `rule_update`, each with a
   distinct `input`. Collect both SSE streams (filter by `?task=` per id).
   Assert each `completed` frame carries **only** its own family's
   deterministic output, and `GET /api/tasks` lists both with the correct,
   non-interleaved `result`. This proves constraint #7.

5. **V3 — hung mock triggers timeout → failed** — `POST /api/tasks` with
   `{ family: "project_setup", payload: { input: {}, mock: { mode: "hang" } },
   timeoutMs: 300 }`. Collect SSE; assert a `task` frame with
   `kind:"failed"`, `errorCode:"timeout"` arrives within ~1s, and
   `GET /api/tasks/[id]` returns `status:"failed"`, `errorCode:"timeout"`.
   Assert `events.jsonl` has `agent_task_failed` with `errorCode:"timeout"`
   and **no** `agent_task_completed`. This proves constraint #6.

6. **V4 — invalid output is NOT repaired (fail-closed at intake)** — `POST
   /api/tasks` with `{ family: "draft_design_system", payload: { input: {},
   mock: { mode: "invalid" } } }`. Collect SSE; assert a `task` frame with
   `kind:"failed"`, `errorCode:"invalid_output"`. Assert `events.jsonl`
   contains an `invalid_output` event and **no** `repaired_output` event, and
   that there was exactly one adapter run (no second "repair" run — verify by
   asserting the SQLite `tasks` row has exactly one `created_at` and the SSE
   stream shows `started` once). This proves constraint #5 (no refeed; Issue
   13 owns repair).

7. **unknown family + auth boundary** — `POST /api/tasks` with an unknown
   family → 400 `unknown_family`; missing/invalid payload → 400
   `invalid_payload`; no active project (before bind) → 400
   `no_active_project`. Reuse the existing 403 spoofed-header assertions
   (bad token / cross-origin / non-local host) on `POST /api/tasks` and
   `GET /api/tasks` to confirm the new routes inherit `authorize()`.

---

## 8. EXACT file list

### NEW files
| Path | Purpose |
|------|---------|
| `lib/runtime/adapter.ts` | `AgentAdapter` interface, `AdapterEvent`, `TaskPayload`, `TaskResult`, `TaskFamily`, `OutputSchemaHook`, constraint-#2 header comment (§1). |
| `lib/runtime/adapters/mock-adapter.ts` | Deterministic family-aware mock; `hang`/`invalid`/`normal` modes via `payload.mock` (§2). |
| `lib/runtime/task-runner.ts` | `createTask` / `listTasks` / `getTask` / `reconcileStaleTasks`; live-handle Map; timeout; join-point zod validation; bus emit; SQLite+JSONL persist (§3). |
| `lib/runtime/task-bus.ts` | `EventEmitter` bus on `globalThis`; `emitTaskEvent` / `onTaskEvent`; channel `"task"` (§6a). |
| `lib/runtime/schemas.ts` | `familySchemas: Record<TaskFamily, OutputSchemaHook>` — zod schemas matching mock outputs (§6b). |
| `app/api/tasks/route.ts` | `POST /api/tasks` (create+start, family whitelist) + `GET /api/tasks` (list, refresh rebuild) (§5). |
| `app/api/tasks/[id]/route.ts` | `GET /api/tasks/[id]` (detail + `live` flag) (§5). |
| `tests/agent-task-runner.spec.ts` | Playwright e2e: happy path + V1a/V1b/V2/V3/V4 + auth/family boundary (§7). |

### MODIFIED files
| Path | Exact change |
|------|--------------|
| `lib/runtime/db.ts` | Add the `tasks` table DDL + 3 indexes to the `SCHEMA` const (§4 Layer 1). No other change. |
| `lib/runtime/events.ts` | Add `"agent_task_completed"` and `"agent_task_failed"` to the `EventType` union (§4 Layer 3). No other change. |
| `app/api/events/route.ts` | Subscribe to the task bus in `start()`; enqueue `event: task` frames; optional `?task=<id>` filter; **unsubscribe in `stop()`/`cancel()`** to avoid listener leaks (§5). Heartbeat behavior unchanged. |
| `package.json` | Add `zod` to `dependencies` (e.g. `"zod": "^3.23.8"`), then `npm install`. (Decision §0.1.) |

### NOT modified (by design)
- `lib/runtime/session.ts` — constraint (do not touch). New routes reuse `authorize()`.
- No UI/sidebar files — **DEFERRED** to a Figma-driven UI issue.

### DEFERRED acceptance criterion
> "Browser UI 在 Agent/sidebar 区域展示当前 task status，但默认不暴露 raw adapter internals."

Deferred to a Figma-driven UI issue (per project `AGENTS.md`: UI/visual/interaction design must come from the designer's Figma reference). This plan exposes everything the UI needs: `GET /api/tasks`(+`/:id`) with `status` + `live` + `result`/`errorCode`, and `event: task` frames on the single `/api/events` SSE (`started`/`progress`/`output`/`completed`/`failed`). The sidebar will consume that contract; no adapter internals are exposed (only `status`, human-readable `message`, and validated `output`).

---

## 9. DEVIATION flags

**No deviations.** All 8 hard constraints are honored:
1. `run()` → `AsyncIterable<AdapterEvent>` (§1). ✅
2. Interface not in-process coupled — stated verbatim in the `adapter.ts` header; no `require` of project files, no shared module state, payload serializable (no AbortSignal — cancellation via `iterator.return()` only) (§1). ✅
3. Progress via in-process `EventEmitter` bus multiplexed on the single `/api/events` SSE; no polling, no per-task SSE (§5, §6). ✅
4. Three layers (SQLite `tasks` + live-handle Map + JSONL via `logEvent`) + `GET /api/tasks[/:id]`; stale reconciliation on read (§3, §4). ✅
5. Schema validation at the join point only: pass → `done`, fail → `failed` + `invalid_output`; no repair refeed (§3 `onDone`). ✅
6. Per-task timeout (default 30s, configurable via `timeoutMs`) → auto `failed`/`timeout` (§3 `onTimeout`). ✅
7. Per-task isolation: independent id/handle/iterator/timeout/row; mock returns fresh objects (§2, §3). ✅
8. `AdapterEvent.kind` ∈ `progress|output|done|error` (§1). ✅

Engineering constraints honored: `npm run check` target green (typecheck + new e2e); new routes mirror `authorize()` + `runtime="nodejs"` + `dynamic="force-dynamic"`; `session.ts` untouched; UI deferred to Figma. ✅

The five open choices in §0 are decisions the constraints explicitly left open
(or invited — e.g. "pick one" for stale reconciliation), each justified in
place; none is a silent deviation.