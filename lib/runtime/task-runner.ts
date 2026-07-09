// Task runner: bridges the AgentAdapter async iterable to the 3-layer task
// state (SQLite tasks table + in-process live-handle Map + JSONL event log)
// and to the in-process EventEmitter bus that /api/events multiplexes.
//
// Module-level state here (liveHandles) is RUNTIME-side infrastructure, NOT
// adapter state — adapters never touch it (constraint #2). It is stashed on
// globalThis so it survives Next.js dev HMR, mirroring session.ts.

import { randomUUID } from "node:crypto";
import { openProjectDb, closeProjectDb } from "./db";
import { logEvent } from "./events";
import { emitTaskEvent } from "./task-bus";
import { getMockAdapter } from "./adapters/mock-adapter";
import {
  getCliAdapter,
  getNoCliAdapter,
  resolveCliCommand
} from "./adapters/cli-adapter";
import { familySchemas } from "./schemas";
import type {
  AgentAdapter,
  AdapterEvent,
  MockControl,
  TaskFamily,
  TaskErrorCode,
  TaskPayload
} from "./adapter";

export type TaskStatus = "running" | "done" | "failed";

export const DEFAULT_TIMEOUT_MS = 30_000; // constraint #6

// Hard upper bound on a client-requested per-task timeout. Without this, an
// authorized client could keep a real CLI subprocess alive indefinitely once
// real Agents are wired (Issue 3A enables that path). Real-CLI risk > mock.
export const MAX_TIMEOUT_MS = 5 * 60_000; // 5 min

// Clamp a client-requested per-task timeout to (0, MAX_TIMEOUT_MS], falling
// back to DEFAULT_TIMEOUT_MS for non-positive / non-finite / non-number input.
// Extracted as a PURE function so the route layer and tests share exactly ONE
// definition of the bound — a regression guard: if someone removes the cap,
// tests/timeout-clamp.spec.ts fails before an unbounded timeout reaches a real
// CLI subprocess. Observing the clamped timeout FIRE end-to-end would take
// MAX_TIMEOUT_MS (5 min), so the bound is unit-tested directly instead.
export function clampTimeoutMs(
  requested: number | undefined | null
): number {
  if (
    typeof requested !== "number" ||
    !Number.isFinite(requested) ||
    requested <= 0
  ) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(requested, MAX_TIMEOUT_MS);
}

export interface LiveHandle {
  taskId: string;
  family: TaskFamily;
  projectPath: string;
  status: TaskStatus;
  adapter: AgentAdapter;
  iterator: AsyncIterator<AdapterEvent> | null;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  timeoutMs: number;
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
const G = globalThis as unknown as {
  __IKRAN_LIVE_HANDLES?: Map<string, LiveHandle>;
};
const liveHandles: Map<string, LiveHandle> =
  G.__IKRAN_LIVE_HANDLES ?? (G.__IKRAN_LIVE_HANDLES = new Map());

// ---- public API ----

// Adapter selection. The mocked adapter is the default for the 8 MVP
// product families (unchanged behavior, existing tests/contract stay green).
// The real_agent_smoke family (Issue 3A) is routed to the common CLI smoke
// runner: command + args come from CONFIG (env), so Codex / Claude Code /
// Cursor profiles can plug in later WITHOUT changing this selector. If no CLI
// is configured, an honest adapter_error ("not configured") is produced rather
// than fabricating a success.
function selectAdapter(family: TaskFamily): AgentAdapter {
  if (family === "real_agent_smoke") {
    const cmd = resolveCliCommand();
    if (!cmd) {
      return getNoCliAdapter(
        "Agent CLI command not configured (set IKRAN_AGENT_CLI_COMMAND)"
      );
    }
    return getCliAdapter({ command: cmd.command, args: cmd.args });
  }
  return getMockAdapter();
}

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
  emitTaskEvent({
    kind: "started",
    taskId,
    family,
    status: "running",
    timestamp: now
  });

  // Layer 2: in-process live handle. Retain the adapter so the runner can call
  // adapter.cancel() directly on timeout — the ONLY reliable way to SIGKILL a
  // hung subprocess (iterator.return() alone orphans it; see cancel-leak fix).
  const adapter = selectAdapter(payload.family);
  const iterable = adapter.run(payload);
  const iterator = iterable[Symbol.asyncIterator]();
  const handle: LiveHandle = {
    taskId,
    family,
    projectPath,
    status: "running",
    adapter,
    iterator,
    timeoutHandle: null,
    timeoutMs,
    startedAt: now
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
      .all() as unknown as TaskRow[];
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
// HMR dropped the handle) is marked failed/abandoned. Justification in PLAN §0.3.
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
      logEvent(projectPath, "agent_task_failed", {
        taskId: row.id,
        family: row.family,
        errorCode: "abandoned"
      });
      emitTaskEvent({
        kind: "failed",
        taskId: row.id,
        family: row.family,
        status: "failed",
        errorCode: "abandoned",
        timestamp: now
      });
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
            kind: "progress",
            taskId: handle.taskId,
            family: handle.family,
            status: "running",
            message: value.message,
            data: value.data,
            timestamp: new Date().toISOString()
          });
          break;
        case "output":
          emitTaskEvent({
            kind: "output",
            taskId: handle.taskId,
            family: handle.family,
            status: "running",
            data: value.data,
            timestamp: new Date().toISOString()
          });
          break;
        case "done":
          await onDone(handle, value.output);
          return;
        case "error":
          onError(
            handle,
            toTaskErrorCode(value.error?.code),
            value.error?.message ?? "adapter error"
          );
          return;
      }
    }
  } catch (err) {
    if (handle.status === "running") {
      onError(
        handle,
        "adapter_error",
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

// Join-point validation (constraint #5): pass → done, fail → failed +
// invalid_output. NO repair re-feed (Issue 13 owns the one-repair loop).
async function onDone(handle: LiveHandle, output: unknown): Promise<void> {
  const schema = familySchemas[handle.family]();
  const parsed = schema.safeParse(output);
  if (parsed.success) {
    finalizeDone(handle, parsed.data);
  } else {
    const message = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    finalizeFailed(handle, "invalid_output", message);
    logEvent(handle.projectPath, "invalid_output", {
      taskId: handle.taskId,
      family: handle.family,
      errors: message
    });
    // Intentionally NO repaired_output / NO re-feed. Issue 13 owns the one-repair loop.
  }
}

function onError(handle: LiveHandle, code: TaskErrorCode, message: string): void {
  finalizeFailed(handle, code, message);
}

function onTimeout(handle: LiveHandle): void {
  if (handle.status !== "running") return;
  handle.timeoutHandle = null;
  // PRIMARY: kill the subprocess directly via adapter.cancel(). This is the
  // only reliable way to SIGKILL a hung subprocess — iterator.return() alone
  // orphans the child (Issue 3A cancel-leak: .return() is queued behind the
  // runner's pending it.next() and never processed, so `finally` never runs).
  // cancel() also wakes the generator so it exits and `finally` runs (no-op).
  try {
    handle.adapter?.cancel?.();
  } catch {
    /* ignore */
  }
  // SECONDARY: cooperative signal via the AsyncIterable protocol. Belt-and-
  // suspenders; harmless if cancel() already killed the child. The runner
  // does NOT wait for the generator. No AbortSignal in the payload (serializable).
  try {
    void handle.iterator?.return?.();
  } catch {
    /* ignore */
  }
  finalizeFailed(handle, "timeout", `task exceeded ${handle.timeoutMs}ms`);
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
  logEvent(handle.projectPath, "agent_task_completed", {
    taskId: handle.taskId,
    family: handle.family
  });
  emitTaskEvent({
    kind: "completed",
    taskId: handle.taskId,
    family: handle.family,
    status: "done",
    output,
    timestamp: now
  });
}

function finalizeFailed(
  handle: LiveHandle,
  code: TaskErrorCode,
  message: string
): void {
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
  logEvent(handle.projectPath, "agent_task_failed", {
    taskId: handle.taskId,
    family: handle.family,
    errorCode: code
  });
  emitTaskEvent({
    kind: "failed",
    taskId: handle.taskId,
    family: handle.family,
    status: "failed",
    errorCode: code,
    errorMessage: message,
    timestamp: now
  });
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
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

const TASK_ERROR_CODES: ReadonlySet<TaskErrorCode> = new Set<TaskErrorCode>([
  "timeout",
  "invalid_output",
  "abandoned",
  "adapter_error"
]);

// Adapter `error` events carry a free-form string code; narrow it to the
// closed TaskErrorCode union, defaulting unknown codes to adapter_error.
function toTaskErrorCode(code: string | undefined): TaskErrorCode {
  if (code && TASK_ERROR_CODES.has(code as TaskErrorCode)) {
    return code as TaskErrorCode;
  }
  return "adapter_error";
}
