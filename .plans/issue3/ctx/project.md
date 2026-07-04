# Project Context — Issue 03 (Mocked AgentAdapter 任务闭环)

Inventory of the Ikran repo at `/Users/bingyizhang/Desktop/recursive-design-agent`
for implementing `issues/03-mocked-agent-task-runner.md`. Captured for a
zero-context executor.

---

## 1. Issue 03 acceptance criteria (verbatim)

From `issues/03-mocked-agent-task-runner.md`:

> - [ ] Ikran Runtime 至少为一个 MVP task family 定义 task creation API，并在 active project 中持久化 task state。
> - [ ] Mocked AgentAdapter 能接收 task payload，并返回 deterministic JSON output。
> - [ ] task lifecycle events 通过 SSE 传给 Browser UI：started、progress（如有）、completed、failed。
> - [ ] Browser UI 在 Agent/sidebar 区域展示当前 task status，但默认不暴露 raw adapter internals。
> - [ ] adapter boundary 的形状允许之后加入 headless CLI adapter，而不需要重写 Browser UI。
> - [ ] 测试验证 Browser UI -> Ikran Runtime -> mocked AgentAdapter -> SSE result 的完整路径。

**Blocked by:** `01-ikran-local-workbench-runtime-health.md` (already complete, see §6).
Issue 13 (`agent-output-validation-repair`) is blocked **by Issue 03** — so the
schema-validation *infrastructure* must be shaped now, but the repair loop is Issue 13's job.

**User stories covered:** 64, 65, 73, 75.

---

## 2. Hardened 0003 agent prompt constraints (verbatim — FOUND)

File exists: `teach/prompts/0003-issue03-agent-prompt.md`. Verbatim body:

> # Issue 03 实现约束（在 `issues/03-...md` + PRD 之上的硬约束）
>
> 先读 `issues/03-mocked-agent-task-runner.md`、`MAP-MVP-PRD.zh-CN.md` 相关章节、现有 `lib/runtime/` 与 `app/api/`。以下是不可静默偏离的硬约束（要偏离就显式提，别偷偷换）——都是"demo 能过但架构错"的坑：
>
> 1. 适配器 `run()` 返回 `AsyncIterable<AdapterEvent>`，不是 `Promise`（否则发不了进度，14 课真 CLI 才爆）。
> 2. 接口不耦合进程内：不 `require` 项目文件、不共享模块级可变状态（14 课真 CLI 是 spawn 子进程，会炸）。写进接口注释。
> 3. 进度走进程内 `EventEmitter` 总线 + 单条 `/api/events` 多路复用；不轮询、不每任务一条 SSE。
> 4. 任务状态三层：SQLite `tasks` 表 + 内存活句柄 Map + JSONL；加 `GET /api/tasks`(+`/:id`) 让刷新能重装。
> 5. schema 校验只做接入点：过→`done`，不过→`failed`+`invalid_output`；不做修复回灌（issue 13 的活）。
> 6. 每任务超时（mock ~30s）→ 自动 `failed`。
> 7. 每任务隔离：独立 input/输出、不共享可变状态。
> 8. `AdapterEvent` kind 按 ACP 语义（progress/output/done/error）。
>
> 验证专门覆盖（issue 验收之外）：跑到一半刷新能重装、两个并发任务不串、挂死 mock 触发超时、非法输出不修复。`npm run check` 过；新 route 镜像现有 `authorize()`+`runtime="nodejs"`，不改 `session.ts`。

**Hardened rules in plain terms (for the executor):**
1. `adapter.run()` → `AsyncIterable<AdapterEvent>` (NOT a Promise). Needed for progress; real CLI in Issue 14 breaks otherwise.
2. Interface must not be in-process coupled: no `require`-ing project files, no module-level mutable shared state (Issue 14 spawns a subprocess). Write this into the interface comments.
3. Progress flows through an in-process `EventEmitter` bus multiplexed onto the single existing `/api/events` SSE. **No polling, no per-task SSE endpoint.**
4. Task state lives in three layers: SQLite `tasks` table + in-memory live-handle Map + JSONL. Add `GET /api/tasks` and `GET /api/tasks/:id` so a mid-run refresh can rebuild.
5. Schema validation only at the intake point: pass → `done`; fail → `failed` + `invalid_output` event. **No repair re-feed** (that is Issue 13's job).
6. Per-task timeout (mock ~30s) → auto `failed`.
7. Per-task isolation: independent input/output, no shared mutable state.
8. `AdapterEvent` kinds follow ACP semantics: `progress` / `output` / `done` / `error`.

Extra verification (beyond the issue's AC): mid-run refresh can rebuild; two
concurrent tasks don't cross-talk; a hung mock triggers timeout; an invalid
output is **not** repaired. `npm run check` must pass; new routes must mirror
the existing `authorize()` + `runtime = "nodejs"` pattern; do **not** modify
`session.ts`.

---

## 3. How `npm run check` is defined + test runner + single-test invocation

### `package.json` scripts (verbatim)
```json
"scripts": {
  "dev": "next dev -H 127.0.0.1 -p 3000",
  "build": "next build",
  "start": "node bin/ikran.mjs",
  "typecheck": "tsc --noEmit",
  "test:e2e": "playwright test",
  "check": "npm run typecheck && npm run test:e2e"
}
```

- **`npm run check` = `tsc --noEmit` followed by `playwright test`.** Typecheck first, then e2e.
- **Test runner: Playwright** (`@playwright/test ^1.61.1`). There is **no vitest, no jest**. All tests are e2e specs under `tests/`.
- **Config:** `playwright.config.ts` — `testDir: "./tests"`, `timeout: 30_000`, `expect.timeout: 10_000`, `baseURL: http://localhost:3000`, single `chromium` project. A `webServer` block auto-starts `npm run dev` against `http://localhost:3000/` (reuseExistingServer when not CI, `timeout: 120_000`).

### Run a single test
```bash
# Single spec file:
npx playwright test tests/ikran-runtime-health.spec.ts

# Single test by title substring:
npx playwright test -g "renders the existing project setup screen"

# Single project + headed (optional debug):
npx playwright test tests/<file>.spec.ts --project=chromium --headed

# Just the typecheck half:
npm run typecheck
```
Note: Playwright boots the Next dev server itself (webServer.command =
`npm run dev`), so do **not** start a separate `npm run dev` before running e2e
locally (it will reuse the existing one when not CI).

---

## 4. Available schema-validation libs + SQLite lib

| Need | Installed? | Evidence |
|------|-----------|----------|
| **zod** | ❌ NOT installed | `node_modules` has no `zod`; no `import ... from "zod"` anywhere in `lib/app/tests` |
| **ajv** | ❌ NOT installed | no `ajv` in node_modules; no `Ajv(` usage |
| **better-sqlite3** | ✅ `^12.11.1` (+ `@types/better-sqlite3 ^7.6.13`) | dependency in `package.json`; already used by `lib/runtime/db.ts` |
| **vitest / jest** | ❌ neither | only Playwright as test runner |

**Implication:** Schema validation for agent outputs must be either (a) hand-rolled
type-guard / shape-check functions, or (b) a newly added dependency (zod or ajv).
Given the hardened rule #5 ("schema 校验只做接入点") and the existing code style
(zero validation deps, hand-rolled `ValidationResponse` discriminated unions in
`lib/runtime/project.ts`), the consistent choice is **hand-rolled validators**
mirroring the existing `ok/false, reason` discriminated-union pattern — unless the
plan explicitly decides to add zod. SQLite is `better-sqlite3` (synchronous API,
already wrapped in `lib/runtime/db.ts` with per-call open/close + WAL).

---

## 5. PRD task-family list + invalid-output rule

From `MAP-MVP-PRD.zh-CN.md` §"Agent 任务契约" (line ~481) and §"待测试模块":

### MVP 任务族 (task families) — verbatim list
1. Project setup task
2. Generate seed alignment questions task
3. Draft design system task
4. Reconstruct seed prototype task
5. Generate design-system view task
6. Create new prototype task
7. Rule update task
8. Export research package task

> "Agent 输出必须进行 schema 校验。"

### Invalid-output handling rule (PRD, verbatim)
> 无效输出触发：
> - invalid-output event，
> - 一次修复请求，
> - 如果成功，则触发 repaired-output event。

> "Runtime 不应静默截断、发明或重新解释设计语义。"

### SSE / HTTP API decisions (PRD, verbatim excerpts)
- "浏览器 UI 通过同源 `/api/*` endpoint 和 SSE 事件流与 Runtime 通信。"
- "Ikran Runtime 暴露同源 HTTP API 用于命令，暴露 SSE 用于任务进度。"
- "Runtime 默认绑定 `127.0.0.1`。"
- "Runtime 应生成启动级本地 session token，避免任意网页调用有权限的本地 API。"
- "浏览器 UI 永远不直接读取或写入本地项目文件。"
- "浏览器 UI 不运行内部模型，也不构建自己的 Agent runtime。"
- Test boundary (highest value): "浏览器 UI -> Ikran Runtime -> mocked AgentAdapter -> 项目 artifacts -> 浏览器 UI render" — "偏好一个高层集成边界，而不是许多低层测试".

**⚠️ Conflict to resolve in the plan:** PRD says invalid output triggers "one
repair request". The hardened `0003` prompt rule #5 says Issue 03 must do **only**
pass→done / fail→`failed`+`invalid_output`, and **no repair re-feed** — repair is
Issue 13's job (`13-...md` is blocked by `03`). The plan must follow the hardened
rule for Issue 03 (fail-closed, no repair) and leave the one-repair loop for Issue
13. The `invalid_output` event type already exists in `lib/runtime/events.ts`'s
`EventType` union (see §6).

---

## 6. Existing test fixtures / patterns to mirror

### Test layout
```
tests/
  cwd-auto-bind.spec.ts          (Issue 2 supplement)
  project-folder-binding.spec.ts (Issue 02)
  ikran-runtime-health.spec.ts   (Issue 01)
```
All three are Playwright e2e. **No unit-test runner.** Mirror these patterns:

### Pattern A — raw HTTP from Node (spoof headers, bypass browser header restrictions)
Copied from `ikran-runtime-health.spec.ts` and `project-folder-binding.spec.ts`:
```ts
import http from "node:http";
const PORT = 3000;
function rawGet(route: string, headers: Record<string,string>): Promise<{status:number; body:string}> { /* http.request 127.0.0.1:PORT */ }
function rawPost(route: string, body: unknown, headers: Record<string,string>): Promise<{status:number; body:string}> { /* writes JSON body */ }
```
Used to assert `403` on missing/bad token, cross-origin Origin, non-local Host — at
the API boundary, independent of the browser.

### Pattern B — capture the real session token from the browser, then reuse for raw HTTP
```ts
let sessionToken: string | null = null;
await page.route("**/api/**", async (route) => {
  const token = route.request().headers()["x-ikran-session"];
  if (token) sessionToken = token;
  await route.continue();
});
await page.goto("/");
// ... then pass { host: "localhost:3000", "x-ikran-session": token } to rawGet/rawPost
```
For SSE tests the token goes via `?session=` query param (EventSource can't set
headers) — see `session.ts` `authorize()` which reads both `x-ikran-session`
header and `?session=` query.

### Pattern C — temp-folder fixture (create/cleanup + global runtime-state backup)
From `project-folder-binding.spec.ts`:
```ts
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
const RUNTIME_STATE_FILE = path.join(homedir(), ".ikran", "runtime-state.json");
let originalRuntimeState: string | null = null;
let testFolder = "";

test.beforeAll(() => { originalRuntimeState = existsSync(RUNTIME_STATE_FILE) ? readFileSync(RUNTIME_STATE_FILE,"utf-8") : null; });
test.beforeEach(() => { testFolder = mkdtempSync(path.join(tmpdir(), "ikran-e2e-")); });
test.afterEach(() => { if (testFolder) rmSync(testFolder, { recursive:true, force:true }); });
test.afterAll(() => { /* restore or remove RUNTIME_STATE_FILE */ });
```
New Issue 03 tests should reuse this exact scaffold (bind the temp folder via
`POST /api/project/bind`, then drive the new task API).

### Pattern D — UI data-testid assertions
```ts
await expect(page.getByTestId("runtime-helper")).toContainText("Local runtime connected");
await expect(page.getByTestId("runtime-service")).toHaveText("ikran-runtime");
```
The new Agent/sidebar task-status surface needs its own `data-testid`(s).

---

## 7. Existing code surface Issue 03 builds on

### `lib/runtime/` (existing modules — extend, don't rewrite)
- **`db.ts`** — `openProjectDb(projectPath)` / `closeProjectDb(db)` / `initializeProjectDb(path)`. Schema currently has `events` + `projects` tables only. **Issue 03 must add a `tasks` table** to this schema (id, family, status, payload, result, error, created_at, updated_at, …) following the same `CREATE TABLE IF NOT EXISTS` + index pattern.
- **`events.ts`** — `logEvent(path, type, payload)` writes to SQLite `events` + appends to `.ikran/events.jsonl`. `EventType` union **already includes** `agent_task_started`, `invalid_output`, `repaired_output` (and `export_generated`, `rule_update_*`, etc.). Use these; the `agent_task_started` event is the "started" lifecycle event.
- **`session.ts`** — `authorize(request)` + `getSessionToken()`. **Do NOT modify** (hardened rule). New routes reuse `authorize(request)` verbatim and set `runtime = "nodejs"`.
- **`paths.ts`** — `getIkranDir`, `getProjectDbPath`, `getProjectEventsPath`, `getArtifactsDir`, `getExportDir`. Add a tasks-JSONL path here if needed.
- **`project.ts`** — `bindProjectFolder`, `getActiveProject`, `getActiveProjectState()` → `{ ok, project } | { ok:false, reason }`. Tasks are scoped to the **active project**, so task API routes call `getActiveProjectState()` first.
- **`config.ts`** — `SERVICE = "ikran-runtime"`, `HOST`, `PORT`, `isLocalhostHostname`.

### `app/api/` (existing routes — mirror exactly)
- `health/route.ts`, `events/route.ts` (SSE heartbeat, `?session=` auth), `project/route.ts` (GET active project + cwd candidate), `project/bind/route.ts`, `project/select-folder/route.ts`.
- **New routes to add for Issue 03:** task creation (`POST /api/tasks`), task list (`GET /api/tasks`), task detail (`GET /api/tasks/:id`). All must: `export const runtime = "nodejs"; export const dynamic = "force-dynamic";` → `authorize(request)` → 403 JSON on fail.
- **SSE for task progress:** per hardened rule #3, do **not** add a per-task SSE endpoint. Instead multiplex task events onto the existing `/api/events` SSE via an in-process `EventEmitter` bus (the current `/api/events` only emits heartbeats; extend it to also forward task bus events).

### Session-token plumbing for SSE in tests
`authorize()` accepts `?session=<token>` (query) for EventSource clients. New
SSE-emitted task events will be readable in tests via `page.evaluate` +
`new EventSource("/api/events?session=" + token)`.

### TypeScript config
`tsconfig.json`: `strict: true`, `target: ES2022`, `module: esnext`, `moduleResolution: bundler`, `noEmit: true`, `jsx: react-jsx`, `isolatedModules: true`, `incremental: true`. Excludes: `node_modules`, `Attempts`, `workflow`, `Research`, `recursive-design-method`. **No path aliases** — imports use relative paths (`../../../lib/runtime/...`). Next.js plugin enabled.

---

## 8. Sibling issues (dependency map)

| Issue | Title | Status | Relation to 03 |
|-------|-------|--------|-----------------|
| 01 | Ikran Local Workbench 启动与 Runtime Health | ✅ Complete | Blocks 03 (done) — provides runtime shell, `/api/health`, `/api/events` SSE heartbeat, `authorize()` session enforcement |
| 02 | 项目文件夹选择与 `.ikran` 元数据 | ✅ Complete | Provides active-project binding (`/api/project/bind`, `getActiveProjectState`), `.ikran/` metadata, SQLite + JSONL event log — Issue 03 tasks live *inside* an active project |
| **03** | Mocked AgentAdapter 任务闭环 | **← this** | — |
| 13 | Agent 输出校验与一次修复 | ⛔ Blocked by 03 | Issue 03 must shape the validation intake (pass→done / fail→`failed`+`invalid_output`) but **leave the one-repair loop to 13** |
| 14 | Headless CLI Agent 适配器 | (future) | The `AsyncIterable<AdapterEvent>` + no-in-process-coupling interface designed in 03 must let 14's spawned-CLI adapter drop in without a UI rewrite |
| 15 | Mocked Full Workflow Test | (future) | Will compose the mocked adapter across the full workflow — depends on 03's adapter boundary |

Other issues present: 04–12, 16 (task-family-specific), README.md.

---

## Quick reference — one-line summary for the executor

`npm run check` = `tsc --noEmit && playwright test` (typecheck then Playwright e2e;
no unit-test runner). Schema validation: **no zod, no ajv** — hand-roll
discriminated-union validators like `lib/runtime/project.ts` or add a dep
explicitly. SQLite: **`better-sqlite3` ^12.11.1** (sync, already wrapped in
`lib/runtime/db.ts`). Hardened `0003` agent prompt: **FOUND** at
`teach/prompts/0003-issue03-agent-prompt.md` (8 hard rules; key ones:
`run()`→`AsyncIterable<AdapterEvent>`, no in-process coupling, in-process
EventEmitter bus multiplexed on `/api/events`, three-layer task state + new
`GET /api/tasks[/:id]`, validate-at-intake with no repair, per-task ~30s timeout,
ACP event kinds).