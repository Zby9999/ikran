# Hardened Headless CLI AgentAdapter Path

## What to build

把早期真实 Agent smoke path 加固成可用于后续 MVP 手动集成检查的 headless external agent adapter。Ikran Runtime 应能调用配置好的 CLI command，传入 task payload，收集 structured output，并复用 mocked adapter 已经使用的 validation、event、repair 和 task lifecycle。

这个 issue 不再负责证明“真实 Agent 能跑一次”这一点；那已经前移到 `03a-real-agent-smoke-adapter.md`。这里负责把该路径扩展到更接近 Codex、Claude Code、Cursor 的真实使用形态，并确保它能承接后续真实 Figma / 真实 Agent smoke checks。

## User stories covered

- 65
- 66
- 73
- 74
- 75

## Acceptance criteria

- [ ] Ikran Runtime 支持配置 hardened headless CLI AgentAdapter，且不需要修改 Browser UI code。
- [ ] adapter 可以把 task payload 传给 command，并收集 structured JSON output。
- [ ] CLI adapter result 复用 mocked adapter 的 task lifecycle、SSE progress surface、validation path 和 event log。
- [ ] CLI adapter result 能接入 Issue 13 的一次 repair path，而不是只做单次 smoke。
- [ ] Ikran Runtime 不嵌入或实现 Figma MCP；任何 Figma MCP dependency 都留在 external agent environment 内。
- [ ] 可以用 fake local CLI command 做自动化 smoke test。
- [ ] 文档或配置说明指出后续如何手动 smoke-test Codex、Claude Code 或 Cursor。

## Blocked by

- `03-mocked-agent-task-runner.md`
- `03a-real-agent-smoke-adapter.md`
- `13-agent-output-validation-repair.md`
