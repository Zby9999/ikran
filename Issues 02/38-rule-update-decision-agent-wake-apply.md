# 38 — Rule Update 单击决定、Agent Wake 与应用状态

Status: ready-for-agent

## Parent

- `29-batch-rule-update-review.md`

## What to build

让设计师在 Rule Update 卡片上直接单击 Accept 或 Reject，不再经过 chat 复述或二次确认。Workbench 是 designer decision 的直接 initiator：Runtime 原子保存决定、相关反馈去向和 durable Agent command；活动中的 Rule Update wait 随即返回。Accept 后 Agent 写入被该 proposal revision 授权的 source artifact；Reject 形成“不提升为全局 Rule”的终局决定且永不修改 artifact。

## Acceptance criteria

- [ ] Accept 与 Reject 是卡片上的直接动作，没有确认弹窗；重复提交、双击和断线重试保持幂等。
- [ ] Workbench 与 chat compatibility path 复用同一 designer-decision command，不存在两套状态机或由 Agent 再次代为确认 Workbench 决定。
- [ ] Accept 原子记录 designer decision、消费相应 feedback disposition 并创建 scoped durable command；界面先显示“已接受，等待 Agent”，不能提前显示已应用。
- [ ] Agent claim 获得确切 review、proposal revision、semantic target 与 base digest；成功写入和声明后状态变为 applied，卡片转化为普通 Rule，绿点才消失。
- [ ] Reject 原子记录 terminal no-rule-change disposition，不写 artifact；卡片从类别规则流移除、绿点按剩余未完成 proposals 重新计算，记录保留在 All interactions。
- [ ] 多个快速决定按 durable 顺序处理；Agent 完成一个决定后，若仍有未决定 proposal，则重新进入同一 review 的 scoped wait。

## Blocked by

- `37-rule-update-proposal-direct-revision.md`

## Real Agent validation

- [ ] 真实 Agent 在活动 wait 中分别被 Accept 与 Reject 唤醒；Accept 完成真实 source write/declaration，Reject 路径确认 source bytes 未变化。

## Open gaps

- 一旦 Agent 已 claim 并开始应用 Accept，不提供假装安全的 UI undo；失败和冲突由 Issue 40 的恢复状态处理。
