# Evidence Surface 与 Annotation Target Vertical Slice

## What to build

在 Figma Evidence Surface 上完成 Annotation target 的第一条端到端路径。设计师和 Agent 都可以创建针对 whole Surface、明确 Figma node 或自由 Region 的 Annotation；Runtime 校验所有 target 必须锚定到明确 captured Evidence Surface/version，并将结果广播回 tldraw custom shape。Figma node target 使用 05C 的 structural overlay 选择与高亮语义节点，region target 使用 raw semantic rect 与 candidates。

此 slice 不做 Question card gate，只证明 anchored annotation record 是一等事实源。

Node selection 采用设计师确认的无额外 metadata chrome 交互：hover 默认最深 selectable node，`Tab` 向父级切换、到顶保持，鼠标移动重置；Agent 从 Runtime/Figma MCP 读取 node name/type/parent。

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
- [x] Refresh 无 correspondence 时，Node Annotation 标记 stale，并按设计师 Figma reference 明确提示；历史 Annotation 仍可查看和回放，不删除、不改写为无效。（原生 `figma-node` 与 Agent-confirmed region `primary_node_id` 均覆盖；Alert 保持 5 秒后渐隐。）
- [x] Workbench 可创建设计师标注，并显示为 tldraw custom shape。
- [x] Workbench node selection 高亮与最终 `figma-node` Annotation target 一致；`Tab` 可逐级切换到 selectable parent 并提交当前高亮节点。画布不显示 node name/type/breadcrumb，Agent 可读取相应 positional identity。
- [x] Agent 创建的标注通过 SSE/refresh 出现在 Workbench。
- [x] 标注类型可为 question、assumption、observed fact、generalization risk，且不影响完成状态。
- [x] 测试覆盖缺少 surface anchor、无效 rect、有效 Agent annotation、有效 designer annotation。
- [x] 测试覆盖 surface/node/region targets、缺失 evidence version、无效 node id、ephemeral hover 不落库，以及 stale Node Annotation 仍可回放。

## Real Agent validation

- [x] 设计师在真实 Figma Evidence Surface 上分别创建至少一个 node target 和一个 free-region target；node 默认最深命中、`Tab` parent 切换与最终 target id 可核对，Agent 可读取 node name/type/parent。（Browser Use：真实 Redo Surface 默认命中 `260:3315` Text，`Tab` 切换到 `260:3314` Frame 后点击，SQLite 持久化 `target_kind=figma-node`、`target_node_id=260:3314`；同一 Surface 拖拽持久化为 `figma-region`。移动鼠标后重新命中最深节点；临时 records 验证后已删除，Annotation 总数恢复为 23。）
- [x] 真实 Agent 基于 Runtime-captured 真实 Figma evidence 创建至少一个 anchored Annotation，并核验至少一个 Runtime candidate 或诚实记录空 candidates。（真实 Annotation `14e67fed-c375-4e01-8844-f4d928a9bc86` 返回 `260:3315` Text 与可解释 ancestors；Agent 经宿主 Figma MCP 核验并确认 primary node。）
- [x] 在受控真实 Figma source 中移除/替换已注释 node 后 Refresh；Workbench 显示 stale warning，且旧 evidence version 与 Node Annotation 仍可回放。
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

Real Agent validation 已完成 4/4 项：真实 Agent anchored Annotation、candidate/Figma MCP 核验、受控 source mutation + Refresh/missing/stale、Workbench semantic record 回连，以及真实 designer node/free-region 创建均已完成。节点交互按设计师最终决策收口为无额外 metadata UI 的 `Tab` parent drill-up；node name/type/parent 仅供 Agent 通过 positional evidence 与宿主 Figma MCP 读取。本次未用 mock/deterministic 结果冒充真实验证。

## Blocked by

- 无剩余 blocker；真实 Figma Evidence Surface 的 node/free-region、`Tab` parent target id 与鼠标移动重置均已通过 Browser Use 复验，无需新增 metadata/breadcrumb UI。

## Performance follow-up — 2026-07-15

- [x] 已修复已选 designer Annotation 的删除交互延迟：Runtime DELETE 成功后，画布立即移除 marker；全量 Workbench refresh 改为后台自愈，失败仍以现有错误提示呈现，不会把已确认删除的 marker 恢复到画布。

验证：新增 Runtime client 回归测试，覆盖 DELETE 成功不等待 evidence/layout/readiness 全量 batch，以及后台 refresh 失败仍报告错误。Browser Use 在真实 Workbench 创建并清理临时 Annotation 后，marker 在 64 ms 内移除；修复前相同路径为 650–1,590 ms。

## Real Agent closeout — 2026-07-15

真实 Agent 与真实 Figma source 已完成 candidate → Figma MCP → primary confirmation → source deletion → Refresh/missing/stale 纵切。根因修复为：`figma-region` 在 Agent 明确确认 `primary_node_id` 后，该节点身份参与后续 current evidence correspondence；旧实现只检查 `target_kind=figma-node`，因此真实区域标记删除节点后不会 stale。Workbench warning 同时接受 stale 的原生 node target 与 confirmed region，保持 5 秒后以 300 ms 渐隐。Browser Use 实测 4.5 秒仍可见、5.4 秒已消失；Figma MCP 对受控删除节点 `260:3315` 返回 not found。最终 `npm run check` 通过（60 unit files / 438 tests；65 e2e tests）。

最终交互复验：Browser Use 在真实 Redo Surface 上确认 hover 默认命中最深节点 `260:3315`，连续 `Tab` 路径为 `260:3315 → 260:3314 → 260:3313 → 260:3312 → 260:3310`，顶层继续 `Tab` 保持 `260:3310`；鼠标移动后重置到 `260:3315`。切换一次父级并点击后，Runtime 持久化 `260:3314`；拖拽仍生成 `figma-region`。两条临时记录通过 Runtime DELETE 清理，数据库恢复到验证前的 23 条 Annotation，Workbench 最后恢复为 Select 模式。
