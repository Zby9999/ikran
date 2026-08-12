# 35 — Scoped Durable Agent Command 与 Rule Update Wait

Status: implemented（Runtime seam 与自动化验证完成；36/38 接入及 Real Agent validation 待做）

## Parent

- `29-batch-rule-update-review.md`

## What to build

让同一个 durable Agent command interface 同时承载 Alignment handoff 与 Rule Update Review handoff。Rule Update 提案全部发布后，Agent 可以在当前 turn 内进入只针对该 review 的 waiting designer response；设计师稍后从 Workbench 作出决定时，Runtime 能立即返回 durable command。该扩展必须保持六环节既有等待行为不变，也不能把 Prototype validation 之后的所有阶段重新变成无限等待区。

## Acceptance criteria

- [x] Durable Agent command 支持明确 scope，至少覆盖 Alignment Attempt 与 Rule Update Review；现有 Alignment command 身份、顺序、幂等和恢复语义保持兼容。
- [x] `wait_for_agent_command` 只有在 Alignment handoff 或活动 Rule Update Review 等待设计师决定时才建立滚动 lease；仅凭项目处于 post-Alignment phase 不足以开启等待。
- [x] 已存在的 pending command 在任意阶段立即返回；idle、页面关闭或 transport 中断不消费 command，也不推进 workflow。
- [x] Rule Update scoped command 在 Agent turn 已结束时仍保持 durable，下一 turn 可优先恢复；实现不声称具备 MCP reverse activation。
- [x] 该 ticket 不增加可见 UI，也不改变 Workbench presence 的研究事实边界。

## Blocked by

None — can start immediately.

## Real Agent validation

- [ ] 真实 Agent 分别验证 Alignment wait 与 Rule Update scoped wait；Workbench 决定可以唤醒活动 turn，idle 后产生的 command 可在下一 turn 恢复。

## Open gaps

- 当前 Agent host 没有生产安全的 idle-turn activation adapter；本 ticket 只覆盖 active-turn wait 与 durable next-turn resume。

## Comments

### 2026-08-11 — Runtime seam implemented

- Schema v32 在同一个 `agent_commands` durable queue 上增加
  `alignment_attempt` / `rule_update_review` scope；旧 Alignment identity、
  idempotency key、时间顺序与下游外键原样迁移。
- Rule Update Review 可显式开启/关闭 wait scope；发布该 scope 的 command
  与关闭 lease 同事务，活动 turn 由 record bus 立即返回，idle 后 command
  仍由下一 turn 优先读取。
- Issue 36 负责在完整 review publish 时调用 activation seam；Issue 38
  负责在 Workbench decision 时原子发布具体 command。由于这两个生产入口
  尚未落地，本 issue 的 Real Agent validation 保持未勾选。
