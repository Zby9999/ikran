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