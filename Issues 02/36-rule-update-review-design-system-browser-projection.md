# 36 — Rule Update Review 在 Design System Browser 中的分类投影

Status: resolved

## Parent

- `29-batch-rule-update-review.md`

## What to build

Agent 完成 reconciliation 与 Consolidate 后，可以一次性开启一轮完整的 Rule Update Review；设计师随后在 Design System Browser 的相应规则类别中看到待定提案，而不是在独立审查面板或第三栏中处理。提案以已选定的 Figma 方向为准，默认折叠并直接出现在目标 Rule 附近；对应类别显示一个绿点，不显示总数或额外 badge。

每轮 review 和 proposal 必须持久表达准确 Rule 草稿、语义目标、revision、base digest、来源 review、证据链和独立的应用状态，避免把“设计师接受”误当作“Agent 已写入”。Agent 只有在全部 proposals 起草完成后才发布 review，不能让设计师审查一个仍在增长的半成品列表。

## Acceptance criteria

- [x] Rule Update Review 有稳定 identity 与明确生命周期；一次发布向设计师暴露该轮完整 proposal 集合，并为 Agent 返回 Rule Update scoped wait 指令。
- [x] Proposal 包含可直接审查和修改的完整 Rule 草稿、typed semantic target、revision、base digest、关联 evidence 与 source target；旧字段兼容迁移不丢失审计记录。
- [x] Design System Browser 保持 Sidebar + 单一主内容列，只在含未完成 proposal 的对应类别显示一个绿点。
- [x] `new` proposal 显示在目标类别的规则流中；`update` 紧邻目标 Rule；`move` 在目标类别显示提案，并在来源位置保留可追踪的移动说明。
- [x] 卡片默认折叠；展开后显示 Proposed、必要时的 Current、reason、affected items 与独立折叠的关联 Runtime-frozen exchanges。
- [x] Workbench 读取、刷新与错误状态来自 Runtime 事实源；成功变更通过 SSE 刷新，无法读取时不伪造空 review。

## Blocked by

- `34-rule-update-review-design-direction-prototype.md`
- `35-scoped-durable-agent-command-rule-update-wait.md`

## Real Agent validation

- [x] MCP staged Agent 从一轮含多项结论的 Review 发布完整 batch；真实 Chromium Workbench 只在正确类别显示绿点和完整、可展开的卡片集合。

## Open gaps

- 已按 Issue 34 的 Mirror 文字状态说明实现；未引用未选择 Prototype，也未把 prototype 组件导入生产代码。

## Comments

- **2026-08-11 设计方向已定**：Issue 34 完成，设计师选定 **Mirror** 方向——提案卡片头与正式 Rule 卡同构（单个状态 chip 同位同规格、chevron hover-reveal、kind/revision 降级为 caption）。完整生产 UI 状态说明见 `34-rule-update-review-design-direction-prototype.md` 的 Direction decision 一节；本 issue 及 37–40 以此为视觉与交互依据，不再等待 Figma 参考。
