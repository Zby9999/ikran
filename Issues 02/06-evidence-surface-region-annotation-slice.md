# Evidence Surface 与 Region Annotation Vertical Slice

## What to build

在 Figma Evidence Surface 上完成 Region Annotation 的第一条端到端路径。设计师可以在 Workbench 中创建标注；Agent 可以通过 MCP tool 创建标注；Runtime 校验所有 Region Annotation 必须锚定到明确 Evidence Surface，并将结果广播回 tldraw custom shape。

此 slice 不做 Question card gate，只证明 anchored annotation record 是一等事实源。

## User stories covered

- 10, 11, 12, 13, 14, 54, 56

## Acceptance criteria

- [ ] `create_region_annotation` 支持 figma-region anchor。
- [ ] Region Annotation 必须包含 `surfaceArtifactId` 或 `surfaceNodeId`。
- [ ] Agent 创建 single-node 语义时必须提供 primary Figma node 或高置信 candidate。
- [ ] Workbench 可创建设计师标注，并显示为 tldraw custom shape。
- [ ] Agent 创建的标注通过 SSE/refresh 出现在 Workbench。
- [ ] 标注类型可为 question、assumption、observed fact、generalization risk，且不影响完成状态。
- [ ] 测试覆盖缺少 surface anchor、无效 rect、有效 Agent annotation、有效 designer annotation。

## Real Agent validation

- [ ] 真实 Agent 基于真实 Figma evidence 创建至少一个 anchored Region Annotation。
- [ ] Workbench 能显示该 annotation，并能回连 semantic record id。

## Likely difficulties for Agent

- Figma 坐标、surface 坐标和 tldraw 坐标容易混淆。
- Agent 可能写“这里/这个按钮”而不提供结构化 anchor。
- tldraw custom shape 的视觉状态容易和 Runtime record 状态双写。

## Suggested ways through

- Anchor schema 中明确 source coordinate space 和 normalized rect。
- Validation error 直接指出缺少 surface id、rect 或 candidate，而不是泛化为 invalid output。
- tldraw shape 只保存 record id 和 display geometry；语义字段只从 Runtime record 渲染。

## Blocked by

- `05-agent-host-figma-evidence-declaration.md`
