# Evidence Surface 与 Annotation Target Vertical Slice

## What to build

在 Figma Evidence Surface 上完成 Annotation target 的第一条端到端路径。设计师和 Agent 都可以创建针对 whole Surface、明确 Figma node 或自由 Region 的 Annotation；Runtime 校验所有 target 必须锚定到明确 captured Evidence Surface/version，并将结果广播回 tldraw custom shape。Figma node target 使用 05C 的 structural overlay 选择与高亮语义节点，region target 使用 raw semantic rect 与 candidates。

此 slice 不做 Question card gate，只证明 anchored annotation record 是一等事实源。

在实施 node hover/highlight、target selection、breadcrumb、annotation affordance 和 stale state 前，必须取得设计师对应的 Figma UI/interaction reference；缺失时停止相关 UI 实施并请求设计。

### 2026-07-10 后续架构收口

当前 Active 契约补充（不改写下方原 AC 语义）：Annotation **持久化 raw semantic rect**；Agent **display padding** 在 Workbench projection 重算，不回写为语义事实；Evidence 使用 **current** lineage（`current_surface_id` / `superseded_by`）选择锚定表面。Annotation **类型/权限的新语义**属于下一 Issue，本 issue 原 AC（含类型为视觉辅助、不影响完成状态）保持不变。详见 PRD 与 ADR 0002。

### 2026-07-12 Runtime-owned positional context

本 issue 在 05C 完成后的 Runtime-captured Figma Evidence Surface 与 structural overlay 上建立 Annotation。Runtime 可基于 positional node index 返回排序 candidates，但不得自动推断 primary node；annotation 可先存在，Agent 经宿主 Figma MCP 核验后再确认 `primaryNodeId`。详见 PRD 与 ADR 0003。

## User stories covered

- 54, 56, 69, 70, 71, 72, 73, 74, 75, 80, 81, 82, 83

## Acceptance criteria

- [x] Active `create_annotation` command/tool 使用显式 target union；现有 region-only 调用迁移到 `figma-region` target，不保留两套互相竞争的 Active write semantics。
- [x] Annotation 支持 `figma-surface`、`figma-node` 与 `figma-region` 三种明确 target；三者都必须包含 captured surface/evidence identity。
- [x] `figma-node` target 必须包含明确 `nodeId` 与 captured `evidenceVersionId`，不能只保存 current node pointer。
- [x] Region Annotation 必须包含 `surfaceArtifactId` 或 `surfaceNodeId`。
- [x] Figma annotation 可在尚未确认 primary node 时创建；Runtime 只返回确定性排序 candidates，不自行写入 `primaryNodeId`。
- [x] Agent 经宿主 Figma MCP 核验 candidate 后，可确认 `primaryNodeId`，且确认记录回连 annotation、surface version 与 source node。
- [x] Refresh 有可信 correspondence 时，Node Annotation 可显示 current 对应 node，但 persisted target 仍锚定 captured evidence version，不自动迁移。
- [ ] Refresh 无 correspondence 时，Node Annotation 标记 stale，并按设计师 Figma reference 明确提示；历史 Annotation 仍可查看和回放，不删除、不改写为无效。
- [x] Workbench 可创建设计师标注，并显示为 tldraw custom shape。
- [ ] Workbench node selection 高亮与最终 `figma-node` Annotation target 一致，提交前设计师能确认 node name/type/breadcrumb。
- [x] Agent 创建的标注通过 SSE/refresh 出现在 Workbench。
- [x] 标注类型可为 question、assumption、observed fact、generalization risk，且不影响完成状态。
- [x] 测试覆盖缺少 surface anchor、无效 rect、有效 Agent annotation、有效 designer annotation。
- [x] 测试覆盖 surface/node/region targets、缺失 evidence version、无效 node id、ephemeral hover 不落库，以及 stale Node Annotation 仍可回放。

## Real Agent validation

- [ ] 设计师在真实 Figma Evidence Surface 上分别创建至少一个 node target 和一个 free-region target，node highlight/breadcrumb 与真实 Figma source 可人工核对。
- [ ] 真实 Agent 基于 Runtime-captured 真实 Figma evidence 创建至少一个 anchored Annotation，并核验至少一个 Runtime candidate 或诚实记录空 candidates。
- [ ] 在受控真实 Figma source 中移除/替换已注释 node 后 Refresh；Workbench 显示 stale warning，且旧 evidence version 与 Node Annotation 仍可回放。
- [x] Workbench 能显示该 annotation，并能回连 semantic record id。（Browser Use 实机核验当前 14 个 Annotation projection 均带有 Runtime `record id`；SQLite 中对应 designer node/region records 可回连。）

## Likely difficulties for Agent

- Figma 坐标、surface 坐标和 tldraw 坐标容易混淆。
- Agent 可能写“这里/这个按钮”而不提供结构化 anchor。
- tldraw custom shape 的视觉状态容易和 Runtime record 状态双写。

## Suggested ways through

- Anchor schema 中明确 source coordinate space 和 normalized rect。
- Validation error 直接指出缺少 surface id、rect 或 candidate，而不是泛化为 invalid output。
- tldraw shape 只保存 record id 和 display geometry；语义字段只从 Runtime record 渲染。

## Completion report — 2026-07-14

已完成 12/14 项 automated AC：`create_annotation` 已收口为三分支显式 target union；Runtime 持久化 captured target、排序 region candidates、独立记录 Agent primary confirmation，并在 Refresh 后仅对可信 current node correspondence 使用 current bounds，保留 captured target/rect 不变。Workbench 的 structure hover、designer/Agent node annotation 共用同一绿色 structure margin，free-region/point/drag 与 SSE projection 均已覆盖。

实现提交：`be75fcb`（已推送 `main`）。最终整体验证为 `npm run check` 完整通过（typecheck；53 unit files / 414 tests；64 e2e tests），Issue 06 的定向 Playwright/MCP coverage 继续通过；Code Review 最终无 blocking finding。

Real Agent validation 已完成 1/4 项：Browser Use 实机读取当前 Workbench 投影，14 个 Annotation shape 均具有 Runtime semantic record id，并可与 SQLite 中的 designer `figma-node` / `figma-region` records 回连。仍未勾选：stale warning 的具体视觉提示，以及 node breadcrumb/确认信息，需要设计师 Figma UI/interaction reference；真实 Agent anchored Annotation、candidate 核验和受控 source mutation/Refresh 仍需要真实 Figma source 与 Agent host。本次未用 mock/deterministic 结果冒充。

## Blocked by

- Automated 剩余两项受缺失的设计师 Figma UI/interaction reference 阻塞；Real Agent 剩余三项需要可控的真实 Figma source 与真实 Agent host。
