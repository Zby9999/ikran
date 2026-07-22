# 17 — Codex App Server Activation Adapter Prototype

**Status:** ready-for-agent

## What to build

在 post-MVP 隔离原型中验证 Codex App Server 是否能让 Ikran 安全地把 durable Agent command 投递到设计师指定的既有 Codex thread。原型必须先证明 live-host continuity，再决定是否进入生产 Adapter：恢复的是准确 thread、不会与 Codex Desktop 形成并发写入、turn 与 approval 在用户当前界面可见，并且保留当前 workspace、conversation history、模型与宿主工具（尤其 Figma MCP）上下文。

本 Ticket 不实现 Ikran 自有模型 runtime，不把 `codex exec`、Codex SDK 启动的独立 headless worker 或私有 UI automation 当成通过，也不进入 MVP blocking path。

## Visual scope

本 Ticket 无产品视觉范围。只允许隔离 adapter prototype、协议 fixture、自动化测试和调查报告；任何 host selection、connection、approval 或 fallback UI 都需要另立有 Figma reference 的 Ticket。

## Acceptance criteria

- [ ] 固定并记录 Codex/App Server 版本、实验性等级与官方协议来源；协议变化必须 fail closed。
- [ ] 用户显式提供或确认 thread identity；Ikran 不扫描、展示或猜测个人 conversation。
- [ ] 在隔离 fixture 中通过 `thread/resume` 恢复准确 thread，并证明 workspace/worktree 与 conversation history 未串线。
- [ ] 证明同一 thread 不会被 Codex Desktop 与 Adapter 并发写入；无法取得 single-writer guarantee 时停止原型，不进入生产实现。
- [ ] 投递一条结构化 Ikran command，并在当前 Codex Desktop UI 中观察到同一 turn、状态、终态与错误；仅在 headless stdout 可见不算通过。
- [ ] 验证模型选择、Ikran MCP、host Figma MCP/插件、认证与 approval policy 延续；缺失任一项都明确记录并 fail closed。
- [ ] 验证 tool/file approval request 能在用户当前宿主界面处理，Ikran 不静默扩大权限。
- [ ] 验证取消、超时、进程退出、网络失败与 App Server 版本不兼容；失败后 durable command 保持 pending，可由 portable next-turn path 接管。
- [ ] Adapter 只消费现有 Runtime-owned command contract；不得改变 Workbench 阶段语义或把 Adapter 可用性变成 workflow 前进条件。
- [ ] 输出 go/no-go 决策；只有全部 live-host continuity gate 通过才提出生产 Adapter Ticket。

## Blocked by

- `07F-agent-host-activation-feasibility-spike.md`

## Not part of MVP

此 Ticket 是 post-MVP capability prototype。07F 已确认 MVP 继续使用 adaptive wait + durable pending command + next-turn resume。
