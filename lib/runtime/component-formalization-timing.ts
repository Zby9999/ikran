import { randomUUID } from "node:crypto";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { closeProjectDb, openProjectDb, withProjectTransaction } from "./db";
import { parseJsonStringArray } from "./json-columns";

export const COMPONENT_FORMALIZATION_STAGES = [
  "conversation_reconciliation",
  "component_code_linking",
  "harness_preparation",
  "artifact_declaration",
  "preview_readiness",
  "live_hero_declaration",
  "verification",
  "formalization"
] as const;

export type ComponentFormalizationStage =
  (typeof COMPONENT_FORMALIZATION_STAGES)[number];
export type ComponentFormalizationTimingStatus =
  | "running"
  | "completed"
  | "failed"
  | "interrupted";
export type ComponentFormalizationSpanStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "interrupted";

type ClockOptions = { now?: () => Date };

export interface BeginComponentFormalizationTimingInput {
  runId: string;
  componentEntryIds: readonly string[];
  stateCount: number;
}

export interface ComponentFormalizationTimingStageMetadata {
  componentCount?: number;
  stateCount?: number;
  previewStartup?: "cold" | "warm";
  cacheStatus?: "hit" | "miss" | "partial" | "bypass";
}

export interface FinishComponentFormalizationTimingStageInput {
  status: "succeeded" | "failed";
  failureCode?: string;
  retryable?: boolean;
}

export interface ComponentFormalizationTimingSession {
  id: string;
  run_id: string;
  component_entry_ids: string[];
  component_count: number;
  state_count: number;
  status: ComponentFormalizationTimingStatus;
  failure_stage: ComponentFormalizationStage | null;
  failure_code: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface ComponentFormalizationTimingSpan {
  id: string;
  session_id: string;
  stage: ComponentFormalizationStage;
  attempt: number;
  status: ComponentFormalizationSpanStatus;
  agent_wait_ms: number;
  runtime_ms: number | null;
  started_at: string;
  ended_at: string | null;
}

export interface ComponentFormalizationStageSummary {
  attempts: number;
  succeeded: number;
  failed: number;
  interrupted: number;
  runtime_ms: number;
  agent_wait_ms: number;
}

export interface ComponentFormalizationTimingSummary
  extends ComponentFormalizationTimingSession {
  total_wall_ms: number;
  runtime_ms: number;
  agent_wait_ms: number;
  retry_count: number;
  preview_startups: Array<"cold" | "warm">;
  cache_statuses: Array<"hit" | "miss" | "partial" | "bypass">;
  time_to_visual_ms: number | null;
  time_to_verified_ms: number | null;
  time_to_formalized_ms: number | null;
  stages: Partial<
    Record<ComponentFormalizationStage, ComponentFormalizationStageSummary>
  >;
}

export type TimedResult = { ok?: boolean; reason?: string };

type SessionRow = {
  id: string;
  run_id: string;
  component_entry_ids_json: string;
  component_count: number;
  state_count: number;
  status: ComponentFormalizationTimingStatus;
  failure_stage: ComponentFormalizationStage | null;
  failure_code: string | null;
  started_at: string;
  ended_at: string | null;
};

type SpanRow = {
  id: string;
  session_id: string;
  stage: ComponentFormalizationStage;
  attempt: number;
  status: ComponentFormalizationSpanStatus;
  component_count: number | null;
  state_count: number | null;
  preview_startup: "cold" | "warm" | null;
  cache_status: "hit" | "miss" | "partial" | "bypass" | null;
  retryable: number;
  failure_code: string | null;
  agent_wait_ms: number;
  started_at: string;
  ended_at: string | null;
  runtime_ms: number | null;
};

function nowIso(options?: ClockOptions): string {
  return (options?.now?.() ?? new Date()).toISOString();
}

function elapsedMs(from: string, to: string): number {
  return Math.max(0, Date.parse(to) - Date.parse(from));
}

function normalizedIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort();
}

function assertCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function sessionFromRow(row: SessionRow): ComponentFormalizationTimingSession {
  return {
    id: row.id,
    run_id: row.run_id,
    component_entry_ids: parseJsonStringArray(row.component_entry_ids_json),
    component_count: row.component_count,
    state_count: row.state_count,
    status: row.status,
    failure_stage: row.failure_stage,
    failure_code: row.failure_code,
    started_at: row.started_at,
    ended_at: row.ended_at
  };
}

function requireRunningSession(
  db: DatabaseType,
  sessionId: string
): SessionRow {
  const row = db
    .prepare(
      `SELECT id, run_id, component_entry_ids_json, component_count,
              state_count, status, failure_stage, failure_code, started_at,
              ended_at
       FROM component_formalization_timing_sessions WHERE id = ?`
    )
    .get(sessionId) as SessionRow | undefined;
  if (!row) throw new Error(`Unknown component formalization timing: ${sessionId}`);
  if (row.status !== "running") {
    throw new Error(
      `Component formalization timing ${sessionId} is already ${row.status}`
    );
  }
  return row;
}

export function beginComponentFormalizationTiming(
  projectPath: string,
  input: BeginComponentFormalizationTimingInput,
  options?: ClockOptions
): ComponentFormalizationTimingSession {
  const runId = input.runId.trim();
  if (!runId) throw new Error("runId is required");
  assertCount(input.stateCount, "stateCount");
  const componentIds = normalizedIds(input.componentEntryIds);
  const id = randomUUID();
  const now = nowIso(options);
  withProjectTransaction(projectPath, (db) => {
    db.prepare(
      `INSERT INTO component_formalization_timing_sessions
       (id, run_id, component_entry_ids_json, component_count, state_count,
        status, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`
    ).run(
      id,
      runId,
      JSON.stringify(componentIds),
      componentIds.length,
      input.stateCount,
      now,
      now
    );
  });
  return {
    id,
    run_id: runId,
    component_entry_ids: componentIds,
    component_count: componentIds.length,
    state_count: input.stateCount,
    status: "running",
    failure_stage: null,
    failure_code: null,
    started_at: now,
    ended_at: null
  };
}

export function getRunningComponentFormalizationTiming(
  projectPath: string,
  runId?: string
): ComponentFormalizationTimingSession | null {
  const db = openProjectDb(projectPath);
  try {
    const row = (runId
      ? db
          .prepare(
            `SELECT id, run_id, component_entry_ids_json, component_count,
                    state_count, status, failure_stage, failure_code, started_at,
                    ended_at
             FROM component_formalization_timing_sessions
             WHERE status = 'running' AND run_id = ?
             ORDER BY started_at DESC, rowid DESC LIMIT 1`
          )
          .get(runId)
      : db
          .prepare(
            `SELECT id, run_id, component_entry_ids_json, component_count,
                    state_count, status, failure_stage, failure_code, started_at,
                    ended_at
             FROM component_formalization_timing_sessions
             WHERE status = 'running'
             ORDER BY started_at DESC, rowid DESC LIMIT 1`
          )
          .get()) as SessionRow | undefined;
    return row ? sessionFromRow(row) : null;
  } finally {
    closeProjectDb(db);
  }
}

export function ensureComponentFormalizationTiming(
  projectPath: string,
  input: BeginComponentFormalizationTimingInput
): ComponentFormalizationTimingSession {
  const running = getRunningComponentFormalizationTiming(
    projectPath,
    input.runId
  );
  if (!running) return beginComponentFormalizationTiming(projectPath, input);
  const existingIds = new Set(running.component_entry_ids);
  const introducesNewComponent = normalizedIds(input.componentEntryIds).some(
    (id) => !existingIds.has(id)
  );
  updateComponentFormalizationTimingScope(projectPath, running.id, {
    componentEntryIds: input.componentEntryIds,
    stateCount: introducesNewComponent
      ? running.state_count + input.stateCount
      : Math.max(running.state_count, input.stateCount)
  });
  return getRunningComponentFormalizationTiming(projectPath, input.runId)!;
}

/** Merge stable identities learned by later deterministic stages. */
export function updateComponentFormalizationTimingScope(
  projectPath: string,
  sessionId: string,
  input: { componentEntryIds?: readonly string[]; stateCount?: number }
): void {
  const stateCount = input.stateCount;
  if (stateCount !== undefined) assertCount(stateCount, "stateCount");
  withProjectTransaction(projectPath, (db) => {
    const session = requireRunningSession(db, sessionId);
    const existing = parseJsonStringArray(session.component_entry_ids_json);
    const ids = normalizedIds([...existing, ...(input.componentEntryIds ?? [])]);
    db.prepare(
      `UPDATE component_formalization_timing_sessions
       SET component_entry_ids_json = ?, component_count = ?, state_count = ?,
           updated_at = ? WHERE id = ?`
    ).run(
      JSON.stringify(ids),
      ids.length,
      stateCount ?? session.state_count,
      new Date().toISOString(),
      sessionId
    );
  });
}

function failureCode(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const value = result as TimedResult;
  if (value.ok !== false) return null;
  return typeof value.reason === "string" && value.reason.trim()
    ? value.reason.trim()
    : "command_failed";
}

/** Best-effort instrumentation wrapper. Timing can never change command behavior. */
export function runComponentFormalizationStage<T>(
  projectPath: string,
  stage: ComponentFormalizationStage,
  metadata: ComponentFormalizationTimingStageMetadata,
  work: () => T,
  options: { runId?: string; startIfMissing?: BeginComponentFormalizationTimingInput } = {}
): T {
  let span: ComponentFormalizationTimingSpan | null = null;
  try {
    const session =
      (options.runId
        ? getRunningComponentFormalizationTiming(projectPath, options.runId)
        : getRunningComponentFormalizationTiming(projectPath)) ??
      (options.startIfMissing
        ? ensureComponentFormalizationTiming(projectPath, options.startIfMissing)
        : null);
    if (session) {
      span = beginComponentFormalizationTimingStage(
        projectPath,
        session.id,
        stage,
        metadata
      );
    }
  } catch {
    span = null;
  }
  try {
    const result = work();
    if (span) {
      try {
        const code = failureCode(result);
        finishComponentFormalizationTimingStage(
          projectPath,
          span.id,
          code
            ? { status: "failed", failureCode: code, retryable: true }
            : { status: "succeeded" }
        );
      } catch {
        // Operational instrumentation must not replace the command result.
      }
    }
    return result;
  } catch (error) {
    if (span) {
      try {
        finishComponentFormalizationTimingStage(projectPath, span.id, {
          status: "failed",
          failureCode: "command_threw",
          retryable: true
        });
      } catch {
        // Preserve the original command error.
      }
    }
    throw error;
  }
}

export async function runComponentFormalizationStageAsync<T>(
  projectPath: string,
  stage: ComponentFormalizationStage,
  metadata: ComponentFormalizationTimingStageMetadata,
  work: () => Promise<T>,
  options: { runId?: string; startIfMissing?: BeginComponentFormalizationTimingInput } = {}
): Promise<T> {
  let span: ComponentFormalizationTimingSpan | null = null;
  try {
    const session =
      (options.runId
        ? getRunningComponentFormalizationTiming(projectPath, options.runId)
        : getRunningComponentFormalizationTiming(projectPath)) ??
      (options.startIfMissing
        ? ensureComponentFormalizationTiming(projectPath, options.startIfMissing)
        : null);
    if (session) {
      span = beginComponentFormalizationTimingStage(
        projectPath,
        session.id,
        stage,
        metadata
      );
    }
  } catch {
    span = null;
  }
  try {
    const result = await work();
    if (span) {
      try {
        const code = failureCode(result);
        finishComponentFormalizationTimingStage(
          projectPath,
          span.id,
          code
            ? { status: "failed", failureCode: code, retryable: true }
            : { status: "succeeded" }
        );
      } catch {
        // Operational instrumentation must not replace the command result.
      }
    }
    return result;
  } catch (error) {
    if (span) {
      try {
        finishComponentFormalizationTimingStage(projectPath, span.id, {
          status: "failed",
          failureCode: "command_threw",
          retryable: true
        });
      } catch {
        // Preserve the original command error.
      }
    }
    throw error;
  }
}

export function beginComponentFormalizationTimingStage(
  projectPath: string,
  sessionId: string,
  stage: ComponentFormalizationStage,
  metadata: ComponentFormalizationTimingStageMetadata = {},
  options?: ClockOptions
): ComponentFormalizationTimingSpan {
  if (!COMPONENT_FORMALIZATION_STAGES.includes(stage)) {
    throw new Error(`Unknown component formalization stage: ${stage}`);
  }
  if (metadata.componentCount !== undefined) {
    assertCount(metadata.componentCount, "componentCount");
  }
  if (metadata.stateCount !== undefined) {
    assertCount(metadata.stateCount, "stateCount");
  }
  const id = randomUUID();
  const now = nowIso(options);
  let result!: ComponentFormalizationTimingSpan;
  withProjectTransaction(projectPath, (db) => {
    const session = requireRunningSession(db, sessionId);
    const running = db
      .prepare(
        `SELECT stage FROM component_formalization_timing_spans
         WHERE session_id = ? AND status = 'running' LIMIT 1`
      )
      .get(sessionId) as { stage: string } | undefined;
    if (running) {
      throw new Error(
        `Component formalization timing ${sessionId} already has a running ${running.stage} stage`
      );
    }
    const prior = db
      .prepare(
        `SELECT ended_at FROM component_formalization_timing_spans
         WHERE session_id = ? AND ended_at IS NOT NULL
         ORDER BY ended_at DESC, rowid DESC LIMIT 1`
      )
      .get(sessionId) as { ended_at: string } | undefined;
    const attemptRow = db
      .prepare(
        `SELECT COUNT(*) AS count FROM component_formalization_timing_spans
         WHERE session_id = ? AND stage = ?`
      )
      .get(sessionId, stage) as { count: number };
    const attempt = Number(attemptRow.count) + 1;
    const agentWaitMs = elapsedMs(prior?.ended_at ?? session.started_at, now);
    db.prepare(
      `INSERT INTO component_formalization_timing_spans
       (id, session_id, stage, attempt, status, component_count, state_count,
        preview_startup, cache_status, agent_wait_ms, started_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      sessionId,
      stage,
      attempt,
      metadata.componentCount ?? null,
      metadata.stateCount ?? null,
      metadata.previewStartup ?? null,
      metadata.cacheStatus ?? null,
      agentWaitMs,
      now
    );
    db.prepare(
      `UPDATE component_formalization_timing_sessions
       SET updated_at = ? WHERE id = ?`
    ).run(now, sessionId);
    result = {
      id,
      session_id: sessionId,
      stage,
      attempt,
      status: "running",
      agent_wait_ms: agentWaitMs,
      runtime_ms: null,
      started_at: now,
      ended_at: null
    };
  });
  return result;
}

export function finishComponentFormalizationTimingStage(
  projectPath: string,
  spanId: string,
  input: FinishComponentFormalizationTimingStageInput,
  options?: ClockOptions
): void {
  const now = nowIso(options);
  withProjectTransaction(projectPath, (db) => {
    const span = db
      .prepare(
        `SELECT id, session_id, stage, attempt, status, component_count,
                state_count, preview_startup, cache_status, retryable,
                failure_code, agent_wait_ms, started_at, ended_at, runtime_ms
         FROM component_formalization_timing_spans WHERE id = ?`
      )
      .get(spanId) as SpanRow | undefined;
    if (!span) throw new Error(`Unknown component formalization span: ${spanId}`);
    if (span.status !== "running") {
      throw new Error(`Component formalization span ${spanId} is already ${span.status}`);
    }
    const runtimeMs = elapsedMs(span.started_at, now);
    const failureCode =
      input.status === "failed"
        ? input.failureCode?.trim() || "unknown_failure"
        : null;
    db.prepare(
      `UPDATE component_formalization_timing_spans
       SET status = ?, retryable = ?, failure_code = ?, ended_at = ?, runtime_ms = ?
       WHERE id = ?`
    ).run(
      input.status,
      input.retryable ? 1 : 0,
      failureCode,
      now,
      runtimeMs,
      spanId
    );
    if (input.status === "failed" && !input.retryable) {
      db.prepare(
        `UPDATE component_formalization_timing_sessions
         SET status = 'failed', failure_stage = ?, failure_code = ?,
             ended_at = ?, updated_at = ? WHERE id = ?`
      ).run(span.stage, failureCode, now, now, span.session_id);
    } else {
      db.prepare(
        `UPDATE component_formalization_timing_sessions
         SET updated_at = ? WHERE id = ?`
      ).run(now, span.session_id);
    }
  });
}

export function completeComponentFormalizationTiming(
  projectPath: string,
  sessionId: string,
  options?: ClockOptions
): void {
  const now = nowIso(options);
  withProjectTransaction(projectPath, (db) => {
    requireRunningSession(db, sessionId);
    const running = db
      .prepare(
        `SELECT 1 FROM component_formalization_timing_spans
         WHERE session_id = ? AND status = 'running'`
      )
      .get(sessionId);
    if (running) throw new Error("Cannot complete timing with a running stage");
    db.prepare(
      `UPDATE component_formalization_timing_sessions
       SET status = 'completed', ended_at = ?, updated_at = ? WHERE id = ?`
    ).run(now, now, sessionId);
  });
}

export function interruptComponentFormalizationTiming(
  projectPath: string,
  sessionId: string,
  failureCode: string,
  options?: ClockOptions
): void {
  const now = nowIso(options);
  withProjectTransaction(projectPath, (db) => {
    requireRunningSession(db, sessionId);
    const open = db
      .prepare(
        `SELECT id, stage, started_at FROM component_formalization_timing_spans
         WHERE session_id = ? AND status = 'running' LIMIT 1`
      )
      .get(sessionId) as
      | { id: string; stage: ComponentFormalizationStage; started_at: string }
      | undefined;
    if (open) {
      db.prepare(
        `UPDATE component_formalization_timing_spans
         SET status = 'interrupted', failure_code = ?, ended_at = ?, runtime_ms = ?
         WHERE id = ?`
      ).run(failureCode, now, elapsedMs(open.started_at, now), open.id);
    }
    db.prepare(
      `UPDATE component_formalization_timing_sessions
       SET status = 'interrupted', failure_stage = ?, failure_code = ?,
           ended_at = ?, updated_at = ? WHERE id = ?`
    ).run(open?.stage ?? null, failureCode, now, now, sessionId);
  });
}

function milestone(
  session: SessionRow,
  spans: SpanRow[],
  stage: ComponentFormalizationStage
): number | null {
  const completed = spans.filter(
    (span) => span.stage === stage && span.status === "succeeded" && span.ended_at
  );
  const last = completed.at(-1);
  return last?.ended_at ? elapsedMs(session.started_at, last.ended_at) : null;
}

export function getComponentFormalizationTiming(
  projectPath: string,
  sessionId?: string
): ComponentFormalizationTimingSummary | null {
  const db = openProjectDb(projectPath);
  try {
    const row = (sessionId
      ? db
          .prepare(
            `SELECT id, run_id, component_entry_ids_json, component_count,
                    state_count, status, failure_stage, failure_code, started_at,
                    ended_at
             FROM component_formalization_timing_sessions WHERE id = ?`
          )
          .get(sessionId)
      : db
          .prepare(
            `SELECT id, run_id, component_entry_ids_json, component_count,
                    state_count, status, failure_stage, failure_code, started_at,
                    ended_at
             FROM component_formalization_timing_sessions
             ORDER BY started_at DESC, rowid DESC LIMIT 1`
          )
          .get()) as SessionRow | undefined;
    if (!row) return null;
    const spans = db
      .prepare(
        `SELECT id, session_id, stage, attempt, status, component_count,
                state_count, preview_startup, cache_status, retryable,
                failure_code, agent_wait_ms, started_at, ended_at, runtime_ms
         FROM component_formalization_timing_spans
         WHERE session_id = ? ORDER BY started_at, rowid`
      )
      .all(row.id) as SpanRow[];
    const stages: ComponentFormalizationTimingSummary["stages"] = {};
    for (const span of spans) {
      const summary = (stages[span.stage] ??= {
        attempts: 0,
        succeeded: 0,
        failed: 0,
        interrupted: 0,
        runtime_ms: 0,
        agent_wait_ms: 0
      });
      summary.attempts += 1;
      if (span.status === "succeeded") summary.succeeded += 1;
      if (span.status === "failed") summary.failed += 1;
      if (span.status === "interrupted") summary.interrupted += 1;
      summary.runtime_ms += span.runtime_ms ?? 0;
      summary.agent_wait_ms += span.agent_wait_ms;
    }
    const end = row.ended_at ?? spans.at(-1)?.ended_at ?? row.started_at;
    return {
      ...sessionFromRow(row),
      total_wall_ms: elapsedMs(row.started_at, end),
      runtime_ms: spans.reduce((sum, span) => sum + (span.runtime_ms ?? 0), 0),
      agent_wait_ms: spans.reduce((sum, span) => sum + span.agent_wait_ms, 0),
      retry_count: spans.filter(
        (span) => span.status === "failed" && span.retryable === 1
      ).length,
      preview_startups: [
        ...new Set(
          spans.flatMap((span) =>
            span.preview_startup ? [span.preview_startup] : []
          )
        )
      ],
      cache_statuses: [
        ...new Set(
          spans.flatMap((span) =>
            span.cache_status ? [span.cache_status] : []
          )
        )
      ],
      time_to_visual_ms: milestone(row, spans, "live_hero_declaration"),
      time_to_verified_ms: milestone(row, spans, "verification"),
      time_to_formalized_ms: milestone(row, spans, "formalization"),
      stages
    };
  } finally {
    closeProjectDb(db);
  }
}
