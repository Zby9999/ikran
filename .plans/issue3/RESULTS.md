# Issue 03 — Mocked AgentAdapter Task Loop: Implementation Results

Backend / Runtime / pipeline only. UI sidebar rendering deferred to a
Figma-driven UI issue (per project `AGENTS.md`). The backend exposes
`GET /api/tasks[/:id]` + `event: task` frames on the single `/api/events` SSE
for the UI to consume later.

## Files created

| Path | Purpose |
|------|---------|
| `lib/runtime/adapter.ts` | `AgentAdapter` boundary: `AsyncIterable<AdapterEvent>` `run()`, `TaskFamily`, `TaskPayload`, `AdapterEvent` (kinds `progress\|output\|done\|error`), `TaskResult`, `OutputSchemaHook`, and the **FILE-LEVEL HEADER COMMENT** stating the no-in-process-coupling constraint (no `require` of project files, no shared module state, payload must stay serializable — no `AbortSignal`; cancellation only via `iterator.return()`). |
| `lib/runtime/adapters/mock-adapter.ts` | Deterministic family-aware mock. Fresh output object per call (isolation). `payload.mock.mode` ∈ `normal\|hang\|invalid`; `progressTicks`/`delayMs` knobs. `hang` awaits a never-resolving promise (runner timeout fires); `invalid` yields a `MALFORMED_OUTPUT` that fails every family schema. |
| `lib/runtime/task-bus.ts` | In-process `EventEmitter` bus on `globalThis` (HMR survival), channel `"task"`, `setMaxListeners(0)`. `emitTaskEvent` / `onTaskEvent`. RUNTIME-side plumbing only — adapters never import it. |
| `lib/runtime/schemas.ts` | `familySchemas: Record<TaskFamily, OutputSchemaHook>` — one zod schema per family, each matching the mock's deterministic output so `normal` passes and `invalid` fails. |
| `lib/runtime/task-runner.ts` | `createTask` / `listTasks` / `getTask` / `reconcileStaleTasks`. 3-layer state (SQLite `tasks` + in-process `liveHandles` Map on `globalThis` + JSONL via `logEvent`). Drives the adapter async iterable, enforces per-task timeout (default 30s, configurable), validates at the join point only (pass→done / fail→`failed`+`invalid_output`, **no repair**), emits to the bus, persists. `timeoutMs` stored on the `LiveHandle` and used in the timeout message (PLAN §3 note). Stale-running reconciliation on READ. |
| `app/api/tasks/route.ts` | `POST /api/tasks` (create+start, 8-family whitelist, 201) + `GET /api/tasks` (list, refresh rebuild source, reconciles stale first). Mirrors `authorize()` + `runtime="nodejs"` + `dynamic="force-dynamic"`. |
| `app/api/tasks/[id]/route.ts` | `GET /api/tasks/[id]` (detail + `live` flag; `params` is a `Promise` per Next.js 16). Mirrors the authorize pattern. |
| `tests/agent-task-runner.spec.ts` | Playwright e2e: happy path + V1a/V1b/V2/V3/V4 + unknown-family/invalid-payload/no-active-project + `authorize()` boundary (7 tests). Raw `node:http` SSE reader (subscribe-before-post), temp-folder fixture, runtime-state backup/restore. |

## Files modified

| Path | Exact change |
|------|--------------|
| `lib/runtime/db.ts` | Added the `tasks` table DDL + 3 indexes (`idx_tasks_status`, `idx_tasks_family`, `idx_tasks_created_at`) to the existing `SCHEMA` const. Additive `CREATE TABLE IF NOT EXISTS` — applied on every `openProjectDb()`, safe for new + existing project DBs. No migration runner. |
| `lib/runtime/events.ts` | Added `"agent_task_completed"` and `"agent_task_failed"` to the `EventType` union (near `agent_task_started`). `agent_task_started` + `invalid_output` already existed. |
| `app/api/events/route.ts` | Subscribed the single SSE stream to the task bus in `start()`; enqueues `event: task` frames alongside heartbeats; optional `?task=<id>` filter; **unsubscribes in `stop()`/`cancel()`/`cleanup`** to avoid listener leaks. Heartbeat behavior unchanged. |
| `package.json` | Added `"zod": "^3.23.8"` to `dependencies` (decision PLAN §0.1); `npm install` ran. |
| `playwright.config.ts` | **DEVIATION** (see below): added `workers: 1`. |

### DEVIATION: `playwright.config.ts` → `workers: 1`

**Reason:** The Ikran Runtime keeps the active-project pointer in a single
shared file (`~/.ikran/runtime-state.json`); the task/event APIs resolve the
project from it via `getActiveProjectState()`. With default parallel workers,
one test's `bind` overwrites another's active-project pointer mid-run. The
existing 11 tests passed in parallel only by luck (sub-second windows); the new
task tests hold the pointer across SSE waits (~0.5–1.5s), which exposed the
latent shared-global-state bug: the first `npm run check` run failed with
(a) my happy-path `POST /api/tasks` getting `400 no_active_project` because
another test's `afterEach` deleted the folder the pointer was aimed at, and
(b) the Issue-02 `project-folder-binding` test's `GET /api/project` assertion
seeing *my* test's folder instead of its own.

Serializing the shared-global-state e2e with a single worker is the correct
minimal fix for this architecture (not a speed choice). This file was **not**
in the PLAN's modified-file list, so it is flagged as a deviation. The suite is
tiny (~9s serial) and `session.ts` is still untouched. All 8 hard constraints
are still honored — this is a test-harness serialization change, not a runtime
change.

## Commands run + exit status + key output

| Command | Exit | Key output |
|---------|------|------------|
| `npm install` (after adding zod) | 0 | `added 1 package` |
| `npm run typecheck` (`tsc --noEmit`) | 0 | clean, no errors |
| `npx playwright test tests/agent-task-runner.spec.ts` | 0 | `7 passed (7.5s)` — happy path + V1a + V1b + V2 + V3 + V4 + boundary |
| `npm run check` (typecheck + full e2e, 1st attempt, default workers) | 1 | **2 failed**: happy-path `POST /api/tasks` 400 (shared active-project pointer clobbered by a parallel test's `afterEach` cleanup); Issue-02 binding test's `/api/project` assertion saw the wrong folder. → led to the `workers: 1` fix above. |
| `npm run check` (after `workers: 1`, run 1) | 0 | `18 passed (8.8s)` (11 existing + 7 new) |
| `npm run check` (after `workers: 1`, run 2 — stability re-check) | 0 | `18 passed (8.9s)` |

## Verification coverage (V1–V4 + issue AC)

- **Happy path (issue AC):** `POST /api/tasks` 201 → live SSE `progress`→`completed` carrying the family's deterministic output → `GET /api/tasks/[id]` `status:"done"` + validated output → SQLite `tasks` row `done` + `events.jsonl` has `agent_task_started` + `agent_task_completed`.
- **V1a (mid-run refresh rebuilds):** slow mock running → `GET /api/tasks` shows `status:"running"`, `live:true`; re-GET (refresh) still running/live; SSE re-opened after refresh still delivers `completed`; SQLite `running` mid-run → `done` after; `events.jsonl` milestones present. 3-layer consistency proven.
- **V1b (stale → abandoned on read):** fake `running` SQLite row with no live handle → `GET /api/tasks` reconciles it to `failed`/`abandoned`; `events.jsonl` gains `agent_task_failed` with `errorCode:"abandoned"`.
- **V2 (isolation):** two concurrent tasks (`draft_design_system` + `rule_update`) — each `completed` SSE frame carries **only** its own family's output shape; `GET /api/tasks` lists both with non-interleaved `result`.
- **V3 (timeout):** `mode:"hang"` + `timeoutMs:300` → SSE `failed` with `errorCode:"timeout"`; `GET /api/tasks/[id]` `failed`/`timeout`; `events.jsonl` has `agent_task_failed` (timeout) and **no** `agent_task_completed`.
- **V4 (invalid not repaired):** `mode:"invalid"` → SSE `failed`/`invalid_output`; exactly one `agent_task_started` (one adapter run); `events.jsonl` has `invalid_output` and **no** `repaired_output`; `GET /api/tasks/[id]` `failed`/`invalid_output`.
- **Boundaries:** unknown family → 400 `unknown_family`; missing payload → 400 `invalid_payload`; no active project → 400 `no_active_project`; missing/bad token, cross-origin, non-local host → 403 on both `POST` and `GET /api/tasks`.

## Unresolved failures

None. `npm run check` is green (typecheck + 18 e2e). The only change outside
the PLAN file list is `playwright.config.ts` `workers: 1`, flagged as a
deviation above with justification.