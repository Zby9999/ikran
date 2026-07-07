# Project Session Binding 与 `.ikran` 迁移

## What to build

把现有项目文件夹绑定、cwd auto-bind 和 `.ikran` 初始化迁移到新的 project/session 上下文。Workbench HTTP API 和 MCP tools 必须操作同一个项目，Runtime 为当前 session 持有 project binding，并在 `.ikran/` 中持久化 SQLite、event log、config 和 artifact index 基础。

这个 slice 完成后，用户能通过 Workbench URL 进入 shell，绑定一个真实本地项目文件夹，刷新后恢复项目状态；Agent tool 和 Workbench API 对同一个 project id/path 生效。

## User stories covered

- 7, 53

## Acceptance criteria

- [ ] Workbench 能绑定本地项目文件夹并初始化 `.ikran/`。
- [ ] Runtime 记录 project creation / folder selected 语义事件。
- [ ] 刷新 Workbench 后能恢复当前 project/session 状态。
- [ ] MCP tool 与 HTTP API 对 project mismatch fail-closed。
- [ ] `.ikran` 至少包含 SQLite 初始化和 event log 基础。
- [ ] 测试覆盖绑定、恢复、project mismatch、无 token 请求。

## Real Agent validation

- [ ] 真实 Agent 打开 Workbench URL 后，引导用户绑定一个真实空项目文件夹。
- [ ] Agent 调用 project 相关 tool 时能看到同一 project/session；失败时记录 open gap。

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
