# 40 — Rule Update 冲突恢复与真实 Agent 闭环 Smoke

Status: ready-for-agent

## Parent

- `29-batch-rule-update-review.md`

## What to build

完成 Rule Update Review 的冲突与中断闭环：当正式 Rule 在 proposal 等待期间被直接编辑、同一 artifact 同时存在多个接受项、Agent wait 超时或 source write 失败时，系统不静默覆盖、不丢失 designer decision，也不把“已接受”误报成“已应用”。设计师始终能从 Design System Browser 看见需要修改、等待 Agent、应用失败或已完成的真实状态。

## Acceptance criteria

- [ ] 待定或已接受 proposal 目标 Rule 被 live edit 改变时，base digest guard 阻止旧 revision 静默覆盖，并把 proposal 转入 needs-revision 状态、保留绿点与完整审计链。
- [ ] 同一 source artifact 的多个 accepted proposals 按可重复的 durable 顺序应用和声明；每次 write 只消费其准确 proposal authorization，失败不会越过后续 command。
- [ ] Agent wait idle、Workbench 页面关闭、Runtime/transport 重连和下一 turn resume 都不会丢失决定或重复应用。
- [ ] apply 失败显示可恢复状态和确定错误；重试仍使用同一 command/proposal identity，并在 source digest 已变化时 fail closed。
- [ ] 自动测试覆盖 scoped eligibility、decision/command 原子性、revision race、same-path queue、Reject 零写入、SSE projection 与恢复路径。
- [ ] 完成真实 Agent staged smoke：发布 review、直接修改、Accept、Reject、Agent apply、All interactions 深链与中断恢复；mock/deterministic 结果和真实验证明确分开记录。

## Blocked by

- `38-rule-update-decision-agent-wake-apply.md`
- `39-rule-update-all-interactions-history.md`

## Real Agent validation

- [ ] 在真实项目和真实 Workbench 中完成上述 staged smoke，并把 host、turn continuity、artifact bytes、proposal linkage 与最终 UI 状态作为证据记录。

## Open gaps

- Host-mediated idle activation 仍不属于 MVP；真实 smoke 只验证 active-turn wait 和 durable next-turn resume。
- 发现新的 host-specific 限制时记录为 follow-up，不用静默 fallback 到第二个 headless Agent writer。
