# 05C — Evidence Refresh 与 Figma Context Handoff

**Status:** ready-for-agent

## What to build

让设计师显式 Refresh 一个 Seed Reference，在同一 append-only evidence lineage 中捕获新的 positional-evidence version，并保留历史 Surface。Workbench 将 positional node index 投影为 screenshot 上的 Figma structural overlay：设计师可以 hover、highlight、选择语义节点并通过 breadcrumb/drill-down 确认 target。Runtime 使用 current positional index 对任意 surface rect 做确定性的空间相交和候选排序；Agent 可读取 Seed/selected-node/region context，随后自主调用宿主 Figma MCP 获取 implementation context。本 issue 同时提供跨 evidence versions 的 node correspondence/missing 结果；Issue 06 负责把它应用到持久 Annotation 和 stale warning。

在实施 hover/highlight、selected bounds、breadcrumb 和 drill-down 前，必须取得设计师对应的 Figma UI/interaction reference；缺失时停止这些 UI 改动并请求设计，不得自主补视觉方案。

## User stories covered

- 13, 72, 73, 80, 82

## Acceptance criteria — automated

- [ ] 重复 paste/add 同一 canonical Reference 不触发 Figma API refresh，不新增 evidence version。
- [ ] 显式 Refresh 调用 Figma API并在成功后追加新 positional-evidence Surface；旧 Surface 不被覆盖，新 Surface 成为 `current_surface_id`，lineage 关系完整。
- [ ] Refresh 任一步失败时 current Surface 不变，不产生半成品 evidence version 或成功事件。
- [ ] Refresh 后历史 Surface 仍可访问，不会被 current Surface 覆盖或删除。
- [ ] positional node index 只包含定位与结构选择所需的 node identity/parent identity/name/type/depth/visibility/selectability/bounds/clip-render bounds，不包含预取的 styles、variables、component implementation 或完整文件树。
- [ ] structural overlay 默认只允许选择 Frame、Section、Component、Instance、Text、Image 与有意义命名的 Group；Vector/Path 不污染默认 hit-test，只能通过显式 drill-down 访问。
- [ ] hover 一个 selectable node 时只高亮该 captured node bounds；重叠节点可通过 breadcrumb、父层级或重复/显式 drill-down 切换，行为与设计师 Figma reference 一致。
- [ ] hover、临时 selection、highlight 与 breadcrumb navigation 不创建 Runtime record/event，也不进入 research export。
- [ ] Workbench 使用一张原始 evidence screenshot + overlay；默认不为每个 node 生成或持久化独立截图，只有选中/提交时可按需生成 crop。
- [ ] 给定 surface + raw semantic rect，Runtime 返回稳定排序的 candidates，并至少包含 node id、bounds、overlap/containment signal；无相交节点时返回空 candidates，而不是发明 primary node。
- [ ] candidate ranking 对固定 fixtures 可重复；坐标换算覆盖截图/media bounds、normalized rect、嵌套 nodes 和边界 clamp。
- [ ] `get_seed_reference_context` 返回 source identity、current evidence identity 和 Figma link，不返回 PAT。
- [ ] `get_annotation_node_candidates` 返回 Runtime 计算的 candidates；Runtime 不写入 `primaryNodeId`。
- [ ] 对 captured node id，Runtime 可返回其在 current positional index 中的 correspondence 或明确 missing；不会自动迁移任何持久语义记录。
- [ ] tests 覆盖 refresh success/failure、lineage、historical Surface、semantic-node filtering、nested/overlapping hit-test、ephemeral overlay state、candidate ranking、empty candidates、correspondence/missing 和 context security。

## Acceptance criteria — real Figma / real Agent

- [ ] 对真实 Seed Reference 执行显式 Refresh；产生新的 current Surface，旧截图/Surface 仍可访问，重复 paste 不增加版本。
- [ ] 在包含嵌套 Frame/Text/Instance 的真实截图区域选择一个自由 rect，Runtime 返回至少一组可解释的真实 node candidates，或诚实记录空结果。
- [ ] 在真实 Figma screenshot 上 hover/select Frame、Instance、Text 与命名 Group，实际高亮区域与 Figma source bounds 可人工核对；Vector/Path 默认不抢占选择。
- [ ] 真实 Agent 通过 selected node/region candidates 调用宿主 Figma MCP，证明 implementation context 未由 Runtime 预取；持久 `primaryNodeId` 确认留给 Issue 06。
- [ ] 使用受控 Figma 修改移除或替换一个 captured node 后执行 Refresh；correspondence API 明确返回 missing，且旧 evidence version 仍可查看。stale Annotation UI 留给 Issue 06。
- [ ] 真实 smoke 明确区分 Runtime positional evidence、Agent Figma MCP implementation context 与 Agent 的最终语义判断。

## Blocked by

- `05B-seed-reference-collection-agent-parity.md`
