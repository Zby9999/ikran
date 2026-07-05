# Seed Evidence React Flow Surface 与锚定标注

## What to build

加入第一个 seed-extraction workbench 路径。设计师可以提供 Figma seed reference，mocked AgentAdapter 返回 seed evidence package，包括 Figma structured evidence、Figma Evidence Surface、region anchors 和 annotations，Browser UI 将它们渲染到 React Flow 工作区中。

React Flow 只承载高层 Evidence Surface 和工作流布局。Region Annotation 是独立 workflow record，由 Figma Evidence Surface 的 overlay 渲染；首次 seed extraction 的设计系统抽取和 seed prototype 重建必须依赖 Figma structured evidence，而不是截图转代码。

## User stories covered

- 1
- 4
- 5
- 6
- 17
- 18
- 74

## Acceptance criteria

- [ ] Browser UI 允许设计师从 Figma seed reference 开始，同时把真实 Figma MCP ingestion 委托给外部 Agent 边界。
- [ ] mocked adapter 返回 deterministic evidence package，其中包含 Figma structured evidence、Figma Evidence Surface、`figma-region` anchor data 和 Region Annotation data。
- [ ] 中心工作区在 React Flow 中渲染 Figma Evidence Surface；Region Annotation 由 surface-local overlay 渲染，不进入 React Flow nodes。
- [ ] annotation type 在视觉上可区分：question、assumption、observed fact、generalization risk。
- [ ] 每个 annotation 都依附于明确 Evidence Surface，并链接到 local region、Figma node candidate、multi-node/layout-region 或 whole-frame anchor。
- [ ] 用户创建 Figma visual region 时，系统/Agent 尝试匹配 Figma structured evidence candidates；候选不要求唯一。
- [ ] Agent 创建 single-node 标注时必须提供 primary Figma node 或高置信 candidate；layout-region / whole-frame 标注必须提供 region rect 和语义说明。
- [ ] 记录 `Figma evidence package returned`、`annotation created` 和必要的 `region selected` 语义事件。
- [ ] 测试验证 mocked evidence 与 annotations 来自 Ikran Runtime 数据，而不是 UI hardcoded fixtures。

## Blocked by

- `02-project-folder-ikran-metadata.md`
- `03-mocked-agent-task-runner.md`
