# 07A — Runtime-owned Next phase 与 Alignment Preparation

**Status:** ready-for-agent

## Parent

- `07-design-intent-alignment-six-part-gate.md`

## What to build

让设计师在完成 Seed Reference 登记后点击一次 `Next phase`，由 Runtime 持久化地进入 Alignment preparation。这个动作必须在同一成功边界内冻结一份 Alignment input snapshot、创建新的 Alignment attempt，并创建 `prepare_design_intent_alignment` Agent command。即使 Agent 当前没有等待、MCP 断开或页面刷新，Workbench 也应继续显示同一个 `preparing` 状态，命令保持 pending，不能退回只存在于前端内存的阶段切换。

`Next phase` 是设计师显式授权 Agent 开始准备六部分问题的语义动作；hover、选择、画布移动、输入但未提交的内容和其他隐式 UI 活动都不能创建 Agent command。

## Visual scope

本 ticket **无新增视觉范围**。实现只复用现有 Folder Chrome、`Next Phase` 按钮、phase error 承载和 Alignment surface，把当前前端本地阶段切换接到 Runtime-owned state；不得新增或重新设计组件、布局、样式、文案、动效或等待界面。

## Acceptance criteria

- [ ] `Next phase` 只出现在 Seed Reference 登记与六部分问题之间，不出现在六个 Alignment section 之间。
- [ ] Design Language Description 非空且 Seed Reference collection 满足现有进入条件时，点击 `Next phase` 原子创建 Alignment input snapshot、状态为 `preparing` 的 Alignment attempt 和一条 `prepare_design_intent_alignment` Agent command；任一步失败均不留下半成品。
- [ ] Snapshot 精确记录当时的 Seed References、current captured evidence versions、项目级 Design Language Description 和各 Reference Notes；创建后不可被后续项目编辑原地改写。
- [ ] Workbench 的 workflow stage 由 Runtime 状态驱动；请求成功后通过正常 HTTP/SSE 投影进入 `preparing`，刷新或重新打开 Workbench 后仍保持该状态。
- [ ] 同一显式动作的安全重试不会重复创建 attempt、snapshot 或 command；真正重新登记 Seed Reference 后的新一次 `Next phase` 除外。
- [ ] Agent 未连接、等待调用已断开或 Runtime 重启时，已提交的 command 仍可恢复为待处理工作。
- [ ] 缺少 Description、没有有效 Seed Reference、已有不可兼容 active attempt 或事务失败时返回可操作错误，并保持原 workflow state。
- [ ] 实现不新增可见 UI；现有控件的结构与视觉保持不变，只补充 durable state 所需的 disabled、ARIA 或测试语义。
- [ ] 自动化测试以真实 Workbench 交互贯穿 HTTP command、SQLite 状态、SSE 投影与 reload，证明 `Next phase` 不是本地 React 状态。

## Blocked by

- `07-design-intent-alignment-six-part-gate.md`
