# Issue 03 — Adversarial Audit

**Audit mode:** skeptical, verify-by-reading-code-AND-running-commands.
**Overall verdict: PASS** — all 8 hard constraints (C1–C8), all 4 extra
verifications (V1–V4), and all engineering constraints hold. `npm run check`
re-run independently → green. One test-harness deviation (`playwright.config.ts
workers:1`) is honestly flagged in RESULTS.md and does not touch runtime
architecture; recorded as the top risk below.

## Re-run evidence (my own, not RESULTS.md's claim)

| Command | Exit | Output |
|---------|------|--------|
| `npx tsc --noEmit` | 0 | clean, no errors |
| `npx playwright test tests/agent-task-runner.spec.ts --reporter=line` | 0 | `7 passed (7.0s)` |
| `npm run check` (typecheck + full e2e) | 0 | `18 passed (8.8s)` |
| `git diff -- lib/runtime/session.ts` | 0 | **empty** — session.ts NOT modified |

## Constraint audit

| Item | Verdict | Evidence |
|------|---------|----------|
| **C1** run() is AsyncIterable, not Promise | **PASS** | `lib/runtime/adapter.ts:98` `run(payload: TaskPayload): AsyncIterable<AdapterEvent>;` (interface). `lib/runtime/adapters/mock-adapter.ts:84` `async function* run(payload: TaskPayload): AsyncIterable<AdapterEvent>` — async generator → `AsyncGenerator` extends `AsyncIterable`. `lib/runtime/task-runner.ts:96-97` consumes it as `iterable[Symbol.asyncIterator]()` + `it.next()`, never `await run(...)`. `npx tsc --noEmit` exit 0 confirms the type is genuinely `AsyncIterable`, not `Promise`. |
| **C2** no in-process coupling; header comment; no shared mutable state beyond bus+Map | **PASS** | `lib/runtime/adapter.ts:1-23` FILE-LEVEL header with a boxed `HARD CONSTRAINT` block forbidding `require()`/import of project files, shared mutable state, and non-serializable payload (AbortSignal/callbacks). `adapter.ts:25` only `import type { ZodTypeAny } from "zod"` (type-only, no runtime coupling). `mock-adapter.ts:5-11` imports only *types* from `../adapter`; its module-level `MOCK_OUTPUTS` (const factory Record) and `MALFORMED_OUTPUT` (frozen) are not mutated. `grep -nE "require\("` in adapter/mock/runner → only match is the comment text at `adapter.ts:7`. Only module-level mutable state: `liveHandles` Map on `globalThis` (`task-runner.ts:56-60`, legit exception) and `bus` EventEmitter on `globalThis` (`task-bus.ts:31-33`, legit exception). The *runner* imports `db`/`events`/`schemas` — that is correct: the runner is runtime-side orchestration, not an adapter; the no-coupling rule applies to the adapter boundary (interface + mock), which is clean. |
| **C3** one EventEmitter bus + single /api/events SSE; no per-task SSE; no polling | **PASS** | `lib/runtime/task-bus.ts` — one `EventEmitter`, one channel `"task"`, `emitTaskEvent`/`onTaskEvent`. `app/api/events/route.ts:42-59` subscribes via `onTaskEvent`, enqueues `event: task` frames on the same stream as heartbeats, optional `?task=<id>` *filter* (still one endpoint). `stop()`/`cancel()`/`cleanup` all call `unsubscribe()` (`route.ts:33-40, 62, 88-91`) → no listener leak. `find app/api -type f` shows NO `/api/tasks/[id]/events` route — only `tasks/route.ts` and `tasks/[id]/route.ts` (both JSON). `grep setInterval/polling` in tasks routes → none. The `/api/events` `setInterval` is server-side heartbeat *push*, not client polling. |
| **C4** three layers (SQLite tasks DDL + live-handle Map + JSONL) + GET /api/tasks(+/:id) rebuild shapes | **PASS** | Layer 1: `lib/runtime/db.ts` `tasks` table DDL (id, family, payload_json, status, result_json, error_code, error_message, created_at, updated_at) + `idx_tasks_status/family/created_at`, applied additively via `db.exec(SCHEMA)` on every `openProjectDb()`. Layer 2: `liveHandles` Map (`task-runner.ts:56-60`). Layer 3: JSONL via `logEvent` → `.ikran/events.jsonl` + SQLite `events` table; runner logs `agent_task_started`/`agent_task_completed`/`agent_task_failed`/`invalid_output` milestones (`events.ts:20-21,36`). Routes: `app/api/tasks/route.ts` GET list + `app/api/tasks/[id]/route.ts` GET one. `TaskView` (`task-runner.ts:113-123`) returns id/family/status/payload/result/errorCode/errorMessage/createdAt/updatedAt/**live** — sufficient to rebuild on refresh; `live` flags in-process vs stale. `reconcileStaleTasks` (`task-runner.ts:161-185`) runs on read. |
| **C5** schema validation join-point only; pass→done, fail→failed+invalid_output; NO repair/refeed | **PASS** | `task-runner.ts:255-272` `onDone`: `schema.safeParse(output)` → success `finalizeDone(handle, parsed.data)`; failure `finalizeFailed(handle, "invalid_output", message)` + `logEvent(..., "invalid_output", ...)`; comment at `:270` "Intentionally NO repaired_output / NO re-feed." `grep -niE "repair\|retry\|fix\|again\|refeed" lib/runtime/task-runner.ts` → only two *comment* matches (`:254`, `:270`); no repair code path. V4 test asserts `startedCount === 1` (one adapter run) and `types` does **not** contain `repaired_output` — passed. |
| **C6** per-task timeout → failed on expiry | **PASS** | `task-runner.ts:25` `DEFAULT_TIMEOUT_MS = 30_000`. `:111` `handle.timeoutHandle = setTimeout(() => onTimeout(handle), timeoutMs);` armed per task in `createTask` (configurable via POST `timeoutMs`). `:278-288` `onTimeout` guards `status==="running"`, best-effort `iterator.return?.()` cancel, then `finalizeFailed(handle, "timeout", \`task exceeded ${handle.timeoutMs}ms\`)`. `timeoutMs` stored on `LiveHandle` (`:36`) and used in the message (PLAN §3 note honored). V3 test (`mode:"hang"`, `timeoutMs:300`) → SSE `failed`/`errorCode:"timeout"`, SQLite `failed`/`timeout`, no `agent_task_completed` — passed. |
| **C7** per-task isolation; no cross-talk; V2 proves it | **PASS** | `task-runner.ts:70` `randomUUID()` per task; each `createTask` builds its own `LiveHandle` (`:100-109`), own iterator (`:96-97`), own `setTimeout` (`:111`), own SQLite row (`:74-82`). `liveHandles` keyed by `taskId`, mutated only by the owning task's driver/timeout. `mock-adapter.ts:116` `MOCK_OUTPUTS[payload.family]()` invokes the factory → fresh object per call. V2 test: two concurrent tasks (`draft_design_system` + `rule_update`) — each `completed` frame carries *only* its own family's output shape; `GET /api/tasks` lists both with non-interleaved `result` — passed. |
| **C8** AdapterEvent.kind exactly 'progress'\|'output'\|'done'\|'error' | **PASS** | `adapter.ts:40` `export type AdapterEventKind = "progress" \| "output" \| "done" \| "error";` and `AdapterEvent.kind: AdapterEventKind`. `mock-adapter.ts` yields only these 4 kinds (`:89,96,104,111,112,117,118`). (Note: the *bus* `TaskBusKind` in `task-bus.ts` adds runner-emitted lifecycle kinds `started`/`completed`/`failed` — that is runtime-side, not the adapter contract, and does not violate C8 which scopes to `AdapterEvent.kind`.) |

## Extra verification coverage

| Item | Verdict | Evidence |
|------|---------|----------|
| **V1** refresh-mid-run rebuild from 3-layer state | **PASS** | `tests/agent-task-runner.spec.ts` V1a: slow mock (10×150ms) → mid-run `getTaskRow(...).status === "running"` (SQLite layer); `GET /api/tasks` shows `status:"running"`, `live:true` (Map layer consulted); re-GET (refresh) still running+live; SSE re-opened still delivers `completed`; `events.jsonl` has `agent_task_started`+`agent_task_completed` (JSONL layer). V1b: fake `running` SQLite row with no live handle → `GET /api/tasks` reconciles to `failed`/`abandoned` + `events.jsonl` gains `agent_task_failed` (abandoned). Together prove 3-layer consistency on refresh. Both passed. |
| **V2** two concurrent tasks don't cross (isolation) | **PASS** | `tests/agent-task-runner.spec.ts` V2: posts `draft_design_system` + `rule_update` concurrently, filters SSE per id, asserts `aCompleted.output` has `designSystemId` and not `proposalId`, `bCompleted.output` has `proposalId` and not `designSystemId`; `GET /api/tasks` rows match. Passed. |
| **V3** hanging mock → timeout → failed | **PASS** | `tests/agent-task-runner.spec.ts` V3: `mode:"hang"`, `timeoutMs:300` → SSE `failed`/`errorCode:"timeout"`; `GET /api/tasks/[id]` `failed`/`timeout`; SQLite `failed`/`timeout`; `events.jsonl` has `agent_task_failed`(timeout), no `agent_task_completed`. Passed. |
| **V4** invalid output → failed+invalid_output, NO repair | **PASS** | `tests/agent-task-runner.spec.ts` V4: `mode:"invalid"` → SSE `failed`/`errorCode:"invalid_output"`; `events.jsonl` `agent_task_started` count === 1 (single adapter run); `invalid_output` present, `repaired_output` absent; `GET /api/tasks/[id]` `failed`/`invalid_output`. Passed. |

## Engineering constraints

| Item | Verdict | Evidence |
|------|---------|----------|
| `npm run check` green (typecheck + new tests) | **PASS** | `npx tsc --noEmit` exit 0; `npx playwright test tests/agent-task-runner.spec.ts` → `7 passed (7.0s)`; `npm run check` → `18 passed (8.8s)` exit 0. |
| new routes mirror `authorize()` + `runtime="nodejs"` | **PASS** | `app/api/tasks/route.ts:15-16` + `:30,45` (authorize first, 403 passthrough on fail); `app/api/tasks/[id]/route.ts:9-10` + `:16`; `app/api/events/route.ts:20-21` + `:24`. All three set `runtime="nodejs"` + `dynamic="force-dynamic"`. Boundary test asserts 403 for no-token / bad-token / cross-origin / nonlocal-host on POST and GET. |
| `session.ts` NOT modified | **PASS** | `git diff -- lib/runtime/session.ts` → empty (exit 0); last commit touching it is `f9f0bd3 Implement Ikran local runtime health` (pre-issue-03). New routes reuse `authorize()` from it. |
| UI deferred to Figma-driven UI issue; backend exposes task status + SSE | **PASS** | No UI/sidebar files changed (file list is all `lib/runtime/*` + `app/api/*` + tests). Backend exposes `GET /api/tasks[/:id]` (`status`+`live`+`result`/`errorCode`) and `event: task` frames on the single `/api/events` SSE — the contract the sidebar will consume. No raw adapter internals leak (only `status`, human-readable `message`, validated `output`). |

## Deviation review

`playwright.config.ts` → `workers: 1`. **DEVIATION** (honestly flagged in
RESULTS.md, not in PLAN's modified-file list). Justification: the Ikran Runtime
keeps the active-project pointer in a single shared file
(`~/.ikran/runtime-state.json`); the longer-running task tests (~0.5–1.5s SSE
waits) exposed a latent shared-global-state race where one test's `afterEach`
cleanup clobbered another's active-project pointer. This is a **test-harness
serialization** change, not a runtime/architecture change — none of the 8 hard
constraints are affected. Verified: full suite green at `workers:1`
(18 passed). See topRisk for the underlying design concern.