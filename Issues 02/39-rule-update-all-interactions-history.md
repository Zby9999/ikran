# 39 — Rule Update All interactions 历史页与深链

Status: resolved

## Parent

- `29-batch-rule-update-review.md`

## What to build

在 Design System Browser Sidebar 左下角提供 All interactions 按钮。点击后不打开 drawer、overlay 或新顶层 tab，而是在同一个主内容区展示所有 Runtime 已冻结、可审计的 Rule Update 交流、proposal revisions、设计师决定和 Agent 应用结果。设计师可从历史项跳回对应类别，并自动展开、高亮具体 Rule Update 卡片。

“All”只指 Ikran Runtime 拥有的 reconciliation snapshots、Workbench decisions 和后续 Agent records；不得暗示能够读取未提交给 Runtime 的任意 Agent-host chat。

## Acceptance criteria

- [x] All interactions 入口固定在 Sidebar 左下角；进入后 Sidebar 保持可用，选择任意类别可退出历史页。
- [x] 历史按 review 分组，投影 review 时间、run/session linkage、完整有序 frozen transcript、proposal revision 变化、designer decision 与 apply outcome。
- [x] Rejected proposals 和 superseded revisions 保留审计可见性，但不会重新出现在当前 Rule 流。
- [x] 点击当前 proposal 导航到其语义类别并展开、高亮；rejected/applied 使用只读终局标签，不伪造仍存在的卡片。
- [x] 页面只投影 Runtime canonical records；缺少 host transcript 时为空并显示范围说明，不生成补写内容或虚假消息时间戳。

## Blocked by

- `37-rule-update-proposal-direct-revision.md`
- `38-rule-update-decision-agent-wake-apply.md`

## Real Agent validation

- [x] 投影测试覆盖 frozen transcript、revision、Reject 终局与无虚假 message timestamp；Workbench 深链当前 proposal 时展开并 1.2s 高亮。

## Open gaps

- reconciliation message 当前若无逐消息 timestamp，UI 只显示可靠的 review/order 信息，不伪造消息时间；是否扩展 timestamp contract 另行评估。
