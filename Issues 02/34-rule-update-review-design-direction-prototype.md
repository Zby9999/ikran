# 34 — Rule Update Review 设计方向 Prototype

Status: ready-for-human

## Parent

- `29-batch-rule-update-review.md`

## What to build

在设计师恢复本轮设计探索时，用隔离 Prototype 与可视 picker 共同确定 Design System Browser 中 Rule Update Review 的具体呈现方向。先探索最高杠杆的 Rule Update 卡片，再单独探索 Sidebar 左下角的 All interactions 页面；Prototype 只用于比较与讨论，不进入生产依赖，也不沿用此前未被选择的原型。

已确定的产品约束不再作为变量：保持 Sidebar + 单一主内容列；只在包含未完成 Rule Update 的对应类别显示绿点；提案卡默认折叠；相关交流在卡片内独立折叠；设计师直接修改提案；接受和拒绝是卡片上的单击动作；All interactions 使用 Sidebar 左下角入口并占用同一主内容区。

## Acceptance criteria

- [ ] Prototype 与生产代码完全隔离，每轮只探索一个明确界面问题，并在真实 Design System Browser 上下文中提供三个真正不同的方向。
- [ ] 每个方向都可实际完成展开交流、直接修改、保存 revision、接受、拒绝与状态反馈；没有死按钮或占位交互。
- [ ] 设计师明确选择方向或要求围绕某方向继续 riff，未选择的方向不进入实现依据。
- [ ] 选定方向被整理为生产 UI 所需的 Figma 参考与状态说明，之后删除探索用 Prototype，除非设计师明确要求保留。

## Blocked by

None — can start when the designer schedules the Prototype round.

## Real Agent validation

- [ ] 真实 Agent 建立 picker、逐个验证全部方向并把选择权交给设计师；选择结果和取舍被记录到本 issue。

## Open gaps

- All interactions 是独立的第二轮探索，不与 Rule Update 卡片方向混在一次 picker 中。
- Prototype 暂不开始；本 issue 完成前，后续生产 UI tickets 保持阻塞。
