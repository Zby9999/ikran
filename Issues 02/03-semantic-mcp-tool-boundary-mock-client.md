# Semantic MCP Tool Boundary 与 Mock Client

## What to build

建立 MVP 最小语义 MCP tool boundary。先实现可测的 tool handlers 和 mock MCP client，用来证明 Agent 可以通过语义 intent 改变 Runtime-owned records，而不是通过 raw exec、headless CLI adapter 或 canvas geometry 直接改状态。

此 slice 至少覆盖 `open_workbench`、`create_or_open_project`、`register_seed_reference`，并为后续 `record_evidence_package`、`create_region_annotation`、`record_artifact_written` 等工具保留统一 handler 形状。

## User stories covered

- 51, 53, 56, 57, 64, 65

## Acceptance criteria

- [ ] 最小 MCP tool handler 边界可以被 mock MCP client 调用。
- [ ] `open_workbench` 返回当前 Workbench URL。
- [ ] `create_or_open_project` 绑定或恢复当前 project/session。
- [ ] `register_seed_reference` 只记录 seed URL 和 original design intent，不访问 Figma。
- [ ] Tool payload 失败时返回结构化错误，不写半成品 records。
- [ ] 无 raw exec tool，无单独 geometry tool。
- [ ] 测试覆盖成功、validation failure、project/session mismatch。

## Real Agent validation

- [ ] Cursor 能发现最小 Ikran MCP tools，并至少调用 `open_workbench`。
- [ ] Codex Desktop 尝试 tool discovery；若受 MCP tool 暴露 bug 影响，记录 fallback。

## Likely difficulties for Agent

- MCP server 的 stdio 生命周期和 Next.js dev server 生命周期可能不一致。
- 真实 Agent 可能倾向直接编辑文件或调用 shell，而不是使用 Ikran tools。
- Tool schema 过宽会导致后续 Runtime 难以校验语义 intent。

## Suggested ways through

- 先把 tool handlers 设计成可由 HTTP/test harness 直接调用的纯函数边界，再接 MCP transport。
- 在 tool descriptions 中明确“所有研究事实源变更必须通过 Ikran tools”。
- Schema 从最小字段开始，后续 issue 扩展，不预留过度泛化 payload。

## Blocked by

- `01-runtime-workbench-url-session-shell.md`
- `02-project-session-binding-ikran-metadata.md`
