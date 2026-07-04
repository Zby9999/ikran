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

  // Layer 2: in-process live handle.
  const iterable = getMockAdapter().run(payload);
  const iterator = iterable[Symbol.asyncIterator]();
  const handle: LiveHandle = {
    taskId,
    family,
    projectPath,
    status: "running",
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
  // Best-effort cooperative cancel via the AsyncIterable protocol (constraint #2:
  // no AbortSignal in the payload). The runner does NOT wait for the generator.
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