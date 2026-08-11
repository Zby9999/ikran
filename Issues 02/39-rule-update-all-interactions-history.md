# 39 — Rule Update All interactions 历史页与深链

Status: ready-for-agent

## Parent

- `29-batch-rule-update-review.md`

## What to build

在 Design System Browser Sidebar 左下角提供 All interactions 按钮。点击后不打开 drawer、overlay 或新顶层 tab，而是在同一个主内容区展示所有 Runtime 已冻结、可审计的 Rule Update 交流、proposal revisions、设计师决定和 Agent 应用结果。设计师可从历史项跳回对应类别，并自动展开、高亮具体 Rule Update 卡片。

“All”只指 Ikran Runtime 拥有的 reconciliation snapshots、Workbench decisions 和后续 Agent records；不得暗示能够读取未提交给 Runtime 的任意 Agent-host chat。

## Acceptance criteria

- [ ] All interactions 入口固定在 Sidebar 左下角；进入后 Sidebar 保持可用，选择任意类别可退出历史页。
- [ ] 历史按 review 分组，显示 review 时间、run/session linkage、完整有序 frozen transcript、proposal revision 变化、designer decision 与 apply outcome。
- [ ] Rejected proposals 和 superseded revisions 保留审计可见性，但不会重新出现在当前 Rule 流或研究成功输出中。
- [ ] 点击关联 proposal 会导航到其当前语义类别，滚动到卡片并展开、高亮；目标已 rejected 或已合并为正式 Rule 时显示相应终局位置。
- [ ] 页面只投影 Runtime canonical records；缺少任意 host chat 数据时明确保持范围，不生成补写内容或虚假时间戳。

## Blocked by

- `37-rule-update-proposal-direct-revision.md`
- `38-rule-update-decision-agent-wake-apply.md`

## Real Agent validation

- [ ] 真实一轮 review 含修改、接受和拒绝后，设计师可在 All interactions 重建完整决策链，并深链回仍存在的 Rule Update 或最终 Rule。

## Open gaps

- reconciliation message 当前若无逐消息 timestamp，UI 只显示可靠的 review/order 信息，不伪造消息时间；是否扩展 timestamp contract 另行评估。
