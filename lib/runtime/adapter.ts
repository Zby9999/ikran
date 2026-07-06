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
// │   • Cancellation has TWO channels (Issue 3A cancel-leak fix):          │
// │       (1) adapter.cancel() — PRIMARY, reliable. The runner calls it    │
// │           directly on timeout/cancel; a real adapter SIGKILLs its      │
// │           subprocess immediately. This is the only channel that        │
// │           actually kills a hung subprocess.                            │
// │       (2) iterator.return() — SECONDARY, cooperative. The runner      │
// │           still calls it, but it CANNOT be relied on to kill the        │
// │           subprocess: while the runner is concurrently draining the     │
// │           iterator (a pending it.next() is in flight), .return() is     │
// │           queued behind that .next() and is never processed (the        │
// │           generator's inner await never settles), so the generator's    │
// │           `finally` never runs and the child is orphaned. This is the  │
// │           Issue 3A cancel-leak, fixed by adding channel (1).            │
// │   • There is STILL no signal in the payload BY DESIGN (a signal is not  │
// │     serializable). The cancel handle lives on the ADAPTER INSTANCE,     │
// │     which the runtime retains on the LiveHandle — never in the payload. │
// │   • cancel() is optional so deterministic mock adapters (no subprocess) │
// │     need not implement it; the runner guards with adapter.cancel?.().    │
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
//
// `real_agent_smoke` is the Issue 3A technical-readiness slice: a tiny real
// external-CLI round-trip that reuses this same task lifecycle. It is NOT a
// product workflow family and does not ingest Figma / write design artifacts.
export type TaskFamily =
  | "project_setup"
  | "seed_evidence_import"
  | "generate_seed_alignment_questions"
  | "draft_design_system"
  | "reconstruct_seed_prototype"
  | "generate_design_system_view"
  | "create_new_prototype"
  | "rule_update"
  | "export_research_package"
  | "real_agent_smoke";

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

/** The boundary. Implementations: mock (this issue), CLI subprocess (Issue 14).
 *
 *  `cancel` is OPTIONAL: a real subprocess adapter implements it to SIGKILL
 *  its child directly on runner timeout/cancel (the ONLY reliable way to kill
 *  a hung subprocess — see the cancel-leak note above). A deterministic mock
 *  adapter with no subprocess may omit it; the runner guards with `?.`. */
export interface AgentAdapter {
  run(payload: TaskPayload): AsyncIterable<AdapterEvent>;
  /** Direct, reliable cancellation. SIGKILLs the subprocess (if any) and
   *  unblocks the generator so it can exit. Safe to call before run() spawns
   *  the child, after the child has exited, or never. Idempotent. */
  cancel?: () => void;
}