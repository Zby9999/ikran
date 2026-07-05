# Mocked AgentAdapter 任务闭环

## What to build

引入第一个 AgentAdapter 边界，先使用 deterministic mocked adapter。Browser UI 应能通过 Ikran Runtime 启动一个 agent task，通过 SSE 观察任务进度，并在没有真实 Figma MCP 或外部 CLI 的情况下看到完成结果。

## User stories covered

- 64
- 65
- 73
- 75

## Acceptance criteria

- [x] Ikran Runtime 至少为一个 MVP task family 定义 task creation API，并在 active project 中持久化 task state。
- [x] Mocked AgentAdapter 能接收 task payload，并返回 deterministic JSON output。
- [x] task lifecycle events 通过 SSE 传给 Browser UI：started、progress（如有）、completed、failed。
- [x] Setup 屏通过 `POST /api/agent/connect` 完成 Agent 连接；失败时卡片下方语义化提示 + 重试（Figma 连接态为准）。
- [ ] Browser UI 在 **React Flow** Agent 工作区展示 task status（Setup 屏不做）。
- [x] adapter boundary 的形状允许之后加入 headless CLI adapter，而不需要重写 Browser UI。
- [x] 测试验证 Browser UI -> Ikran Runtime -> mocked AgentAdapter -> SSE result 的完整路径。
  > API 级 e2e 已覆盖；Setup UI 不断言 task 生命周期。

## Blocked by

- `01-ikran-local-workbench-runtime-health.md`

## Implementation notes (2026-07-04)

本次会话完成了 Issue 03 的后端/管线实现，并修复了 e2e 并行底层。UI 侧栏渲染按项目规则留给 Figma 驱动的 UI issue，后端已把 task status + SSE 暴露好供 UI 消费。

### 落地内容（backend / runtime / plumbing only）

**新增文件：**
- `lib/runtime/adapter.ts` — `AgentAdapter` 边界。`run(payload): AsyncIterable<AdapterEvent>`（不是 Promise）；`AdapterEvent.kind ∈ progress | output | done | error`（ACP 语义）；文件级头注释硬约束“不耦合进程内”（不 require 项目文件、不共享模块级可变状态、payload 可序列化、只能用 `iterator.return()` 取消——为 Issue 14 真 CLI spawn 子进程留形）。
- `lib/runtime/adapters/mock-adapter.ts` — 确定性、按 family 区分；`payload.mock.mode ∈ normal | hang | invalid`；每次调用产出新对象（隔离）。
- `lib/runtime/task-bus.ts` — 进程内 `EventEmitter`（挂在 `globalThis`，HMR 安全），channel `"task"`。**发现：`events.ts` 原本没有 pub/sub 总线，`/api/events` 只发心跳——所以约束 3 是新建总线 + 把 `/api/events` 接上去。**
- `lib/runtime/schemas.ts` — 每个 family 一个 zod schema。
- `lib/runtime/task-runner.ts` — 三层状态（SQLite `tasks` 表 + 进程内 `liveHandles` Map + JSONL via `logEvent`）；per-task 超时默认 30s 可配；**接入点校验、不修复**（过→done，不过→failed+`invalid_output`，无 repair 回灌）；`reconcileStaleTasks` 在读时把 running-but-no-live-handle 转成 failed/`abandoned`（进程重启场景）。
- `app/api/tasks/route.ts`（POST 创建 + GET 列表）+ `app/api/tasks/[id]/route.ts`（GET 单个，带 `live` 标志）—— 镜像 `authorize()` + `runtime="nodejs"` + `dynamic="force-dynamic"`。
- `tests/agent-task-runner.spec.ts` — API 级 Playwright e2e：happy path + V1a/V1b/V2/V3/V4 + authorize 边界。

**修改文件：**
- `lib/runtime/db.ts` — `tasks` 表 DDL + 3 个索引（加式 `CREATE TABLE IF NOT EXISTS`）。
- `lib/runtime/events.ts` — `EventType` 加 `agent_task_completed` / `agent_task_failed`。
- `app/api/events/route.ts` — 单条 SSE 订阅 task bus，`event: task` 帧与心跳共流，`?task=<id>` 过滤，`stop()`/`cancel()` 解订阅。
- `package.json` — 加 `zod ^3.23.8`（项目原本无 schema 库）。

### 硬约束 + 验证

8 条硬约束（C1–C8）+ 4 条专门验证（V1–V4）全部 PASS，逐条证据（file:line + 命令输出）见 `.plans/issue3/AUDIT.md`。`npm run check` 绿。

验收项状态：task creation API + 持久化、mocked adapter 返回确定性 JSON、SSE lifecycle（started/progress/completed/failed）、adapter 边界可演进到 headless CLI、完整路径测试——均满足。

### Frontend decisions (Setup)

- Setup 屏为最终 UI，无左右侧栏。
- Agent 步骤：`POST /api/agent/connect` + Figma [`Connect Your Agent`](https://www.figma.com/design/FSgnAj1yrNlgDCt4V4wTfa/recursive-design-agent?node-id=23-1123)；失败时红色 helper 显示语义化文案（无独立可点 Try again）。
- `Start Building` 是进入 React Flow 工作区的入口；正常流程无额外提示，三步完成即亮起。进入失败时：保持 **disabled** 灰样式，按钮内替换为简短语义化文案（无句号、无 Try again）；主页面尚未接线。
- Task API/SSE 不在 Setup 消费；React Flow 工作区阶段再处理 task status。

### Frontend implementation (Setup UI, 2026-07)

- `AgentConnectorCard` 接 `POST /api/agent/connect`；`agent-error-message.ts` 映射失败文案。
- 连接态：选中 Agent 白底 + 绿勾，helper 绿色「{Agent} connected」；文件夹已绑未选 Agent 时 Step 3 头图/序号紫色。
- `connecting` / `error` helper 分别为进行中与红色错误文案；重试靠再次点击 Agent 按钮。
- `SetupActionButton`（Figma `29:1521`）：`border-radius 12px`、高 32px；禁用浅灰渐变 + 外圈 `#9a9a9a`，启用深灰渐变 + 外圈 `#424242`；无 squircle clip。
- `Start Building`：`buildingReady`（文件夹已绑 + Agent 已连接）时亮起；**暂无 `onClick`**；工作区入口失败态待 React Flow 接线。

### e2e 并行底层修复（去掉 `workers:1` 的掩盖）

实现报告里诚实标注了一个偏差：`playwright.config.ts` 被改成 `workers: 1`，因为 Runtime 的 active-project 指针是单进程全局单例（`~/.ikran/runtime-state.json` via `getActiveProjectState()`），并行 Playwright worker 共用一个 Next dev server 会互相覆盖指针。这属于“demo 能过但架构错”的坑，本次按 A 方案修底层让 e2e 真并行：

- **`globalSetup` 一次 `next build`** 进 `.next/e2e-build`（相对路径、gitignored）。
- **每个 worker 一个 `next start`**：独立端口 + 独立 `IKRAN_STATE_DIR`（per-worker mkdtemp）+ 共享只读 build；worker-scoped fixture，`detached:true` + `process.kill(-pid)` 杀整组（含 Next 的 `next-server` worker 孙进程）。
- 就绪探活打 `/`（不是 `/api/health`——后者要 session token，无 token 返 403）。
- 生产 runtime 零改动：只给 `lib/runtime/paths.ts` 加 `IKRAN_STATE_DIR` env 门（默认仍 `~/.ikran`）；`next.config.ts` 加 `IKRAN_NEXT_DIST_DIR` env 门（默认 `.next`）。`session.ts` 未动。

**改的文件：** `lib/runtime/paths.ts`、`next.config.ts`、`playwright.config.ts`、`tests/fixtures.ts`、`tests/global-setup.ts`、`tests/e2e-constants.ts`，4 个测试文件迁移到 fixture。**没碰任何前端。**

**路上踩的坑（都修了）：**
1. `healthProbe` 打 `/api/health` → 无 token 全 403 → 死等超时。改打 `/`。
2. Next 16 对**绝对路径** distDir 会把 `next-env.d.ts` 算成 `".//Users/..."`，在 repo 根造 `Users/`/`var/` 垃圾目录。改用**相对** distDir `.next/e2e-build`。
3. `next build`/`next dev` 会改写提交文件 `tsconfig.json` + `next-env.d.ts`——globalSetup 快照、globalTeardown 还原，跑后 `git diff` 干净。
4. Playwright worker-scoped fixture 必须放进 `extend<{}, {runtime}>` 的第二个泛型（T 只允许 `scope:'test'`）。

**结果：** `npm run check` 18 e2e 用 4 workers 并行 ~8.5s 通过，多次稳定；无孤儿进程、无垃圾目录、提交文件无抖动。

### 未决

- 全部改动未提交；工作树里还混着之前 Issue 02 cwd-auto-bind 的在途改动（`components/setup/ProjectSetupCard.tsx`、`app/api/project/route.ts`、`bin/ikran.mjs`、`lib/runtime/cwd-candidate.ts`、`tests/cwd-auto-bind.spec.ts`）。分成独立提交待用户点头。
- 完整设计/结果/审计分别见 `.plans/issue3/{PLAN,RESULTS,AUDIT}.md`。
