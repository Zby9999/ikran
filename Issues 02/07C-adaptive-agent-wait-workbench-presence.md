# 07C — 三分钟 Adaptive Agent Wait 与 Workbench Presence

**Status:** ready-for-agent

## Parent

- `07-design-intent-alignment-six-part-gate.md`

## What to build

让仍处于活跃 turn 的 Agent 可以通过 Ikran MCP 等待下一条 durable Agent command。默认等待窗为三分钟；当 Workbench 表明设计师仍在真实操作或思考过程中保持 engaged 时，Runtime 将截止时间滚动到“当前时间加三分钟”。当设计师已经 idle、等待 transport 被取消，或 Agent host 不允许继续保持调用时，等待可以结束，但 workflow 不前进，之后产生的 command 仍保持 pending，供下一次 Agent turn 优先读取。

Workbench presence 只是控制等待租约的 ephemeral operational signal，不是研究事实，也不替代 `Next phase` 或 `Complete` 等显式语义动作。

## Visual scope

本 ticket **无产品视觉范围**。Presence 从现有 Workbench 的 visibility、focus、interaction 与 semantic activity 获取；不得新增在线指示器、倒计时、toast、等待面板、设置项或其他可见状态。

## Acceptance criteria

- [ ] 没有 pending command 时，Agent 可调用语义 wait surface；有 pending command 时立即返回最早可执行 command，不人为等待完整窗口。
- [ ] 初始等待窗为三分钟；有效 engaged signal 将 deadline 重置为当前时间加三分钟，而不是累计增加固定时长。
- [ ] engaged 至少要求页面可见、处于焦点且存在近期设计师交互、未提交编辑活动或已提交语义活动之一；仅保持页面连接、后台打开或机械 heartbeat 不能无限续期。
- [ ] 连续有效活动可以跨越多个三分钟窗口保持等待；活动停止并越过 deadline 后，wait 以明确的 idle/no-command 结果结束。
- [ ] idle、timeout、页面关闭、MCP transport 取消和 Agent host 断开都不会自动推进 workflow，也不会丢失之后或同时创建的 durable command。
- [ ] `Next phase` 或 `Complete` 创建 command 后，当前有效 wait 尽快返回，使同一个 Agent turn 可以继续；若该 turn 已结束，下一 Agent turn 必须先读到 pending command。
- [ ] Presence、heartbeat、deadline extension 与 idle 状态不进入 canonical research events、successful research export 或 Alignment input snapshot。
- [ ] 三分钟是产品语义而非单连接实现限制；若 host/transport 有更短 timeout，可在不改变可观察语义的前提下分段等待或重连。
- [ ] 时间相关单元与集成测试使用 fake clock，覆盖首次三分钟、滚动续期、后台页面不续期、idle 退出、command/timeout race 和断线恢复；测试套件不真实 sleep 三分钟。
- [ ] one-process vertical test 覆盖真实 Workbench presence、Runtime lease decision、MCP waiter 返回和 command durability。

## Blocked by

- `07A-runtime-owned-alignment-handoff.md`
