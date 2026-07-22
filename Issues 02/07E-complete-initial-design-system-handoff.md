# 07E — Complete 与 Initial Design System Preparation Handoff

**Status:** ready-for-agent

## Parent

- `07-design-intent-alignment-six-part-gate.md`

## What to build

让设计师回答完六部分问题后点击一次全局 `Complete`，由 Runtime 在同一成功边界内完成 Alignment、冻结该 attempt、进入 Initial Design System preparation，并创建 `prepare_initial_design_system` Agent command。Workflow 必须立即前进，不依赖 Agent 当时是否活跃；Agent-dependent 工作可以继续保持 pending，由当前 waiter 或稍后的 Agent turn 处理。

这个切片只交付从 Alignment 到下一阶段的可靠 handoff，不提前实现 Issue 08 的 source artifact declaration 或 Issue 09 的 Design System derived view。

## Visual scope

本 ticket **无新增视觉范围**。复用现有全局 `Complete`、Folder Chrome/stage navigation 和 Workbench canvas 容器；不得新增完成确认、transition screen、pending view、banner、toast、布局、样式、文案或动效。Issue 08/09 继续负责其各自已有设计范围内的 artifact 与 Design System surface。

## Acceptance criteria

- [ ] `Complete` 只在 attempt 为 `answering` 且六部分 coverage 全部满足时可执行；`preparing`、缺答、abandoned 或 completed 状态都不能再次完成。
- [ ] 点击 `Complete` 时，Runtime 按 Issue 07 规则原子接受剩余非空 proposed answers、形成全部 final answers、把 attempt 标记为 `completed`、进入 Initial Design System preparation，并创建一条 `prepare_initial_design_system` command。
- [ ] 任一步失败时 Alignment、workflow stage 和 command 均不发生部分提交；客户端可安全重试而不会产生重复 command 或重复完成事件。
- [ ] completed attempt、snapshot、questions、final answers 与 answer sources 形成不可变的下一阶段输入，不能再返回 Seed Reference 或修改 Alignment。
- [ ] Workbench 在 Runtime 确认后立即投影 Initial Design System preparation；即使 Agent idle 或 MCP 未连接，也不把界面停留在已完成的 Alignment。
- [ ] 有有效 adaptive waiter 时，新 command 可由同一 Agent turn 继续处理；没有 waiter 时 command 保持 pending，下一 Agent turn 优先读取。
- [ ] 下一阶段的 pending、claimed 或失败状态不会回滚已经 completed 的 Alignment；Workbench 能清楚区分 workflow 已前进与 Agent 工作尚未完成。
- [ ] 完成与阶段切换只接线现有控件和容器；Agent pending/claimed 状态通过 Runtime/API、非视觉 ARIA/data state 与测试表达，不新增可见 UI。
- [ ] one-process vertical test 覆盖 Workbench 回答、全局 `Complete`、原子状态变化、MCP 可见 command、SSE 投影和 reload durability。

## Blocked by

- `07B-agent-command-alignment-preparation.md`
