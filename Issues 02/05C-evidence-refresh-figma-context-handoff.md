# 05C — Evidence Refresh 与 Figma Context Handoff

**Status:** ready-for-agent

## What to build

让设计师显式 Refresh 一个 Seed Reference，在同一 append-only evidence lineage 中捕获新的 positional-evidence version，并保留历史 Surface。Workbench 将 positional node index 投影为 screenshot 上的 Figma structural overlay：设计师可以 hover、highlight、选择语义节点并通过 breadcrumb/drill-down 确认 target。Runtime 使用 current positional index 对任意 surface rect 做确定性的空间相交和候选排序；Agent 可读取 Seed/selected-node/region context，随后自主调用宿主 Figma MCP 获取 implementation context。本 issue 同时提供跨 evidence versions 的 node correspondence/missing 结果；Issue 06 负责把它应用到持久 Annotation 和 stale warning。

在实施 hover/highlight、selected bounds、breadcrumb 和 drill-down 前，必须取得设计师对应的 Figma UI/interaction reference；缺失时停止这些 UI 改动并请求设计，不得自主补视觉方案。

## User stories covered

- 13, 72, 73, 80, 82

## Acceptance criteria — automated

- [x] 重复 paste/add 同一 canonical Reference 不触发 Figma API refresh，不新增 evidence version。
- [x] 显式 Refresh 调用 Figma API并在成功后追加新 positional-evidence Surface；旧 Surface 不被覆盖，新 Surface 成为 `current_surface_id`，lineage 关系完整。
- [x] Refresh 任一步失败时 current Surface 不变，不产生半成品 evidence version 或成功事件。
- [x] Refresh 后历史 Surface 仍可访问，不会被 current Surface 覆盖或删除。
- [x] positional node index 只包含定位与结构选择所需的 node identity/parent identity/name/type/depth/visibility/selectability/bounds/clip-render bounds，不包含预取的 styles、variables、component implementation 或完整文件树。
- [x] structural overlay 默认只允许选择 Frame、Section、Component、Instance、Text、Image 与有意义命名的 Group；Vector/Path 不污染默认 hit-test，只能通过显式 drill-down 访问。
- [ ] hover 一个 selectable node 时只高亮该 captured node bounds；重叠节点可通过 breadcrumb、父层级或重复/显式 drill-down 切换，行为与设计师 Figma reference 一致。
- [x] hover、临时 selection、highlight 与 breadcrumb navigation 不创建 Runtime record/event，也不进入 research export。
- [x] Workbench 使用一张原始 evidence screenshot + overlay；默认不为每个 node 生成或持久化独立截图，只有选中/提交时可按需生成 crop。
- [x] 给定 surface + raw semantic rect，Runtime 返回稳定排序的 candidates，并至少包含 node id、bounds、overlap/containment signal；无相交节点时返回空 candidates，而不是发明 primary node。
- [x] candidate ranking 对固定 fixtures 可重复；坐标换算覆盖截图/media bounds、normalized rect、嵌套 nodes 和边界 clamp。
- [x] `get_seed_reference_context` 返回 source identity、current evidence identity 和 Figma link，不返回 PAT。
- [x] `get_annotation_node_candidates` 返回 Runtime 计算的 candidates；Runtime 不写入 `primaryNodeId`。
- [x] 对 captured node id，Runtime 可返回其在 current positional index 中的 correspondence 或明确 missing；不会自动迁移任何持久语义记录。
- [x] tests 覆盖 refresh success/failure、lineage、historical Surface、semantic-node filtering、nested/overlapping hit-test、ephemeral overlay state、candidate ranking、empty candidates、correspondence/missing 和 context security。

## Acceptance criteria — real Figma / real Agent

- [x] 对真实 Seed Reference 执行显式 Refresh；产生新的 current Surface，旧截图/Surface 仍可访问，重复 paste 不增加版本。（Browser Use 对真实节点 `260:3308` 复验：约 4.46 秒完成，current Surface 从 `c9fde43b…` 更新为 `08ae2dd9…`；旧 Surface 保留并以 `superseded_by` 指向新版本，canonical duplicate 复用已在前序 smoke 验证。）
- [ ] 在包含嵌套 Frame/Text/Instance 的真实截图区域选择一个自由 rect，Runtime 返回至少一组可解释的真实 node candidates，或诚实记录空结果。
- [x] 在真实 Figma screenshot 上 hover/select Frame、Instance、Text 与命名 Group，实际高亮区域与 Figma source bounds 可人工核对；Vector/Path 默认不抢占选择。
- [ ] 真实 Agent 通过 selected node/region candidates 调用宿主 Figma MCP，证明 implementation context 未由 Runtime 预取；持久 `primaryNodeId` 确认留给 Issue 06。
- [ ] 使用受控 Figma 修改移除或替换一个 captured node 后执行 Refresh；correspondence API 明确返回 missing，且旧 evidence version 仍可查看。stale Annotation UI 留给 Issue 06。
- [ ] 真实 smoke 明确区分 Runtime positional evidence、Agent Figma MCP implementation context 与 Agent 的最终语义判断。

## Blocked by

- Runtime Refresh 无 blocker；剩余 breadcrumb/drill-down UI 需要设计师 Figma interaction reference，其余 real smoke 需要可控的真实 Figma source 与 Agent host。

## Completion report — 2026-07-14

已完成 14/15 项 automated AC：canonical duplicate reuse、explicit Refresh append-only lineage、失败回滚、历史 Surface、最小 positional node index、默认 selectable-node filtering、ephemeral structure overlay、稳定 candidate ranking、context/correspondence MCP handoff 与 no-PAT boundary 均已实现。实现提交：`da5e29d`（已推送 `main`）。

验证由 refresh/seed-capture、Figma positional evidence、context/correspondence、structure overlay 与 MCP suites 覆盖；后续完整 unit suite 53 files / 414 tests 通过。代码审查最终无 blocking finding。

仍未勾选 hover 的完整 breadcrumb/父层级/drill-down 交互，因为缺少对应设计师 Figma UI/interaction reference；Real Figma / real Agent AC 全部保持未勾选，本轮没有用 deterministic fixtures 替代真实验证。

## Completion report follow-up — 2026-07-15

真实 Refresh 超时根因已定位并修复：Figma REST 的 `/me`、nodes 和 images 请求均成功，signed S3 screenshot 也会快速返回 200 与正确 Content-Length，但 Node 全局 `fetch` 不读取标准 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量，导致 screenshot body 走不可用直连并在 30 秒后超时。Runtime 的 Figma client 现使用 Undici `EnvHttpProxyAgent`，同时尊重 `NO_PROXY`；没有降低截图 scale、尺寸或质量。

真实节点 `yNZdUYsVVUKuaEVl6YhoRA / 260:3308` 经 Browser Use Refresh 成功，Workbench 显示设计师更新后的 Redo frame；SQLite 证明 append-only lineage、current pointer 与历史 Surface 均正确，锚定旧 evidence version 的 6 个 Annotation records 继续保留并在 Workbench 投影。Real Figma / real Agent AC 当前完成 1/6，其余项目保持未勾选。验证：`npm run check` 完整通过（typecheck；53 unit files / 415 tests；64 e2e tests），新增 proxy transport 回归测试先红后绿，`git diff --check` 通过。
