# tldraw Workbench Shell 替换 React Flow Seed Entry

## What to build

把当前 React Flow seed evidence workbench 迁移为 tldraw Workbench shell。用户在 Workbench 中输入 Figma seed reference 和 original design intent，Runtime 通过 MCP/HTTP 语义边界登记 seed reference，并在 tldraw 中投影一个初始 canvas record。

此 slice 不要求真实 Figma evidence package，也不创建 Region Annotation 或 Question card。目标是完成“seed entry -> Runtime record -> tldraw projection”的端到端纵切。

## User stories covered

- 5, 6, 9, 54, 55

## Acceptance criteria

- [ ] Workbench 使用 tldraw 作为画布底座，不再依赖 React Flow seed surface。
- [ ] 用户能提交 Figma seed reference 和 original design intent。
- [ ] Runtime 创建 seed reference record，并记录语义事件。
- [ ] tldraw shape 投影该 record，并携带 canvas record id。
- [ ] tldraw geometry 不作为研究事实源持久化。
- [ ] 测试验证刷新后 semantic record 仍在，geometry 可重建或丢失不影响事实源。

## Real Agent validation

- [ ] 真实 Agent 调用 `register_seed_reference` 登记一个真实 Figma link。
- [ ] Workbench 显示对应 tldraw projection；Agent 不需要直接操作画布。

## Likely difficulties for Agent

- 当前 Workbench 组件直接使用 React Flow，迁移时容易把旧 node/edge 状态当事实源保留。
- tldraw 本地 store 和 Runtime semantic records 的同步边界容易混淆。
- 没有最终 Figma 设计稿时，UI 改动可能违反项目设计规则。

## Suggested ways through

- 先做最小 tldraw shell，只投影一个 seed record，不实现复杂布局。
- 定义 record id 到 shape metadata 的单向投影，避免从 shape 反推语义。
- UI 细节沿用已有 Figma 参考；无参考的视觉变化只做最小可用。

## Blocked by

- `02-project-session-binding-ikran-metadata.md`
- `03-semantic-mcp-tool-boundary-mock-client.md`
