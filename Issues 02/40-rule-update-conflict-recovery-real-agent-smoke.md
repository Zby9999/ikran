# 40 — Rule Update 冲突恢复与真实 Agent 闭环 Smoke

Status: resolved

## Parent

- `29-batch-rule-update-review.md`

## What to build

完成 Rule Update Review 的冲突与中断闭环：当正式 Rule 在 proposal 等待期间被直接编辑、同一 artifact 同时存在多个接受项、Agent wait 超时或 source write 失败时，系统不静默覆盖、不丢失 designer decision，也不把“已接受”误报成“已应用”。设计师始终能从 Design System Browser 看见需要修改、等待 Agent、应用失败或已完成的真实状态。

## Acceptance criteria

- [x] 待定或已接受 proposal 目标 Rule 被 live edit 改变时，base digest guard 在 claim 和 artifact declaration 两处阻止旧 revision 静默覆盖，并转入 needs-revision。
- [x] 同一 source artifact 的多个 accepted proposals 按 durable 顺序应用和声明；move 按路径分别冻结 digest 并在全部授权 path 声明后才 applied，失败不会越过后续 command。
- [x] Agent wait idle、Workbench 页面关闭、Runtime/transport 重连和下一 turn resume 不会丢失决定或重复应用；command/wait 均在 SQLite 中持久化。
- [x] apply 失败显示可恢复状态和确定错误；重试使用同一 command/proposal identity，并在 source digest 已变化时 fail closed。
- [x] 自动测试覆盖 scoped eligibility、decision/command 原子性、revision、base drift、same-path queue、Reject 零写入、SSE projection 与恢复路径。
- [x] 完成 staged smoke：发布完整 review、Accept、Reject、Agent claim、真实 source declaration、Applied 普通 Rule 与绿点清除；deterministic MCP orchestration 和真实 Chromium UI 验证分开执行。

## Blocked by

- `38-rule-update-decision-agent-wake-apply.md`
- `39-rule-update-all-interactions-history.md`

## Real Agent validation

- [x] `tests/design-system-browser.spec.ts` 记录 Runtime/MCP/Workbench 的 proposal linkage、source declaration 与最终 UI；Browser 技能另行检查本地生产页面可加载。

## Open gaps

- Host-mediated idle activation 仍不属于 MVP；真实 smoke 只验证 active-turn wait 和 durable next-turn resume。
- 发现新的 host-specific 限制时记录为 follow-up，不用静默 fallback 到第二个 headless Agent writer。
