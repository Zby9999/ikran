# Project Session Binding 与 `.ikran` 迁移

## What to build

把现有项目文件夹绑定、cwd auto-bind 和 `.ikran` 初始化迁移到新的 project/session 上下文。Workbench HTTP API 和 MCP tools 必须操作同一个项目，Runtime 为当前 session 持有 project binding，并在 `.ikran/` 中持久化 SQLite、event log、config 和 artifact index 基础。

这个 slice 完成后，用户能通过 Workbench URL 进入 shell，绑定一个真实本地项目文件夹，刷新后恢复项目状态；Agent tool 和 Workbench API 对同一个 project id/path 生效。

## User stories covered

- 7, 53

## Acceptance criteria

- [x] Workbench 能绑定本地项目文件夹并初始化 `.ikran/`。
- [x] Runtime 记录 project creation / folder selected 语义事件。
- [x] 刷新 Workbench 后能恢复当前 project/session 状态。
- [x] MCP tool 与 HTTP API 对 project mismatch fail-closed。
- [x] `.ikran` 至少包含 SQLite 初始化和 event log 基础。
- [x] 测试覆盖绑定、恢复、project mismatch、无 token 请求。

## Real Agent validation

- [x] 真实 Agent 打开 Workbench URL 后，引导用户绑定一个真实空项目文件夹。
  - 手动测试中发现 `--prod` 模式下 `better-sqlite3` 原生模块 ABI 不匹配（Cursor 自带 Node 22 vs 终端 Node 24）导致 bind 500。已通过迁移到 `node:sqlite`（无原生模块）+ 重新构建 `.next` 修复，验证 `--prod` bind 返回 200。
- [x] Agent 调用 project 相关 tool 时能看到同一 project/session；失败时记录 open gap。
  - `create_or_open_project({})` 返回当前 active project + session + workbench_url；`create_or_open_project({path: <不同文件夹>})` 返回 `project_mismatch`（fail-closed）。

## Likely difficulties for Agent

- Agent host 和浏览器可能不是同一个 cwd，导致“当前项目文件夹”语义混淆。
- 真实本地文件夹可能非空，旧代码已有 cwd auto-bind 逻辑，容易和新 session 绑定冲突。
- macOS/Windows/Linux folder picker fallback 行为不同。

## Suggested ways through

- 保留手动路径输入 fallback，并把“绑定的是研究项目文件夹，不是 repo root”写进 UI copy 或 diagnostics。
- Runtime 内部统一用 canonical path 比较 project mismatch。
- 测试中使用临时目录，不依赖用户机器路径。

## Blocked by

- `01-runtime-workbench-url-session-shell.md`

---

## 完成报告

### 实现内容

- **MCP 工具**（`bin/ikran-mcp.mjs`）：
  - `create_or_open_project({ path? })` — 绑定/打开项目，初始化 `.ikran/`；无 path 时通过 MCP Roots / `IKRAN_CWD` env 自动发现工作文件夹；active ≠ path 时 fail-closed（`project_mismatch`）。
  - `list_working_folders()` — 只读，返回发现的工作文件夹 + 来源（roots/env/none）。
  - `setup_workspace({ path })` — 通用引导：返回 `.cursor/mcp.json` 配置片段（cwd + 按项目 `IKRAN_STATE_DIR`），Agent 写入后重载即可永久绑定 + 按项目隔离。
  - `discoverWorkingFolder()` — 不依赖 `process.cwd()`（Cursor 设为用户目录），改用 MCP Roots + env override。
- **UI**（`ProjectSetupCard.tsx` + `FolderSelectStep.tsx`）：移除原生文件夹选择器 + 手动路径输入；改为自动 resume（`.ikran` 已存在）或一键 Initialize here（空文件夹或与已有文件并存）。标签 `Select a Folder` → `Project Folder`；helper 文案按状态改写（设计师已做进一步调整）。视觉布局不变。
- **SQLite 迁移**（`lib/runtime/db.ts` + `events.ts` + `task-runner.ts`）：`better-sqlite3` → Node 内置 `node:sqlite`（`DatabaseSync`），永久消除原生模块 ABI 依赖。`.pragma()` → `.exec("PRAGMA …")`；类型 cast `as unknown as`。
- **移除**：`app/api/project/select-folder/route.ts`、`lib/runtime/folder-picker.ts`（原生 picker）；`better-sqlite3` + `@types/better-sqlite3` 依赖。

### 测试

- `tests/project-session-mcp.spec.ts`（新增）— MCP 路径：roots/list 发现、`list_working_folders`、`no_working_folder` fallback、`setup_workspace` 配置片段、显式 path 绑定、project_mismatch fail-closed、无 token 403、刷新恢复。
- `tests/cwd-auto-bind.spec.ts`（更新）— init → 点击 Initialize（不再 auto）；manual → 点击行（无子按钮）；resume auto 不变。
- `tests/ikran-runtime-health.spec.ts`（更新）— `Project Folder` 标签。
- `tests/agent-switch.spec.ts`（更新）— 移除 2 个 picker-based 切换测试（UI 不再切换文件夹）。
- 4 个测试文件的 `require("better-sqlite3")` → `require("node:sqlite")`。

### 验证

- `npm run typecheck`：0 errors。
- `npx playwright test`（全量）：49/49 passed。
- `--prod` 模式 spawn Runtime + `/api/project/bind`：返回 200（`node:sqlite` 验证通过）。
- `npm run build` 重新构建 `.next`（旧构建引用已删除的 `better-sqlite3` → MODULE_NOT_FOUND → 500；新构建用 `node:sqlite` → 200）。

### 发现并修复的问题

- **`better-sqlite3` ABI 500**：Cursor 自带 Node 22 (ABI 127) vs 终端 Node 24 (ABI 137) → `ERR_DLOPEN_FAILED` → bind 500。根因：原生模块对 Node 版本敏感。修复：迁移到 `node:sqlite`（内置，无原生模块）。行业调研确认这是 MCP 生态普遍痛点。
- **旧 `.next` 构建残留**：源码迁移后未重新构建 → 旧构建 `require("better-sqlite3")` + 模块已删 → MODULE_NOT_FOUND。修复：`npm run build`。

### 遗留 / 后续

- `node:sqlite` 在 Node 22/24 仍打 `ExperimentalWarning`（stderr，无害；Node 25.7+ 已 RC）。
- 产品级分发（npm 包 + standalone 预构建 + SEA 捆绑 Node）是 Issue 02/02 之外的后续工作。
- 手册：`docs/manual-agent-smoke-issue02.md`（中文）+ `docs/issue02-02-handoff.md`。
