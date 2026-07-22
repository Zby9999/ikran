# 07D — 返回 Seed Reference、废弃 Attempt 与重新生成问题

**Status:** ready-for-agent

## Parent

- `07-design-intent-alignment-six-part-gate.md`

## What to build

让设计师在 Alignment attempt 仍处于 `preparing` 或 `answering` 时显式返回 Seed Reference 登记。Runtime 将当前 attempt 标记为 abandoned，使其 questions、answers 与未完成 Agent command 不再属于 current Alignment；历史内容保留用于审计，但不得进入 successful research case。设计师修改或重新登记 Seed References 后，再次点击 `Next phase` 必须创建新的 snapshot、attempt、command 和完整问题集，不能复用旧问题。

已经点击 `Complete` 的 attempt 保持不可逆，不允许通过这条路径重新打开 Seed Reference 登记。

## Visual scope

本 ticket **无新增视觉范围**。返回 Seed Reference 复用现有 Folder Chrome 的 back/navigation affordance 与既有 Seed Reference surface；不得新增返回按钮、确认弹窗、abandoned banner、toast、布局、样式、文案或动效。Attempt 是否废弃及能否重开完全由 Runtime state 决定。

## Acceptance criteria

- [ ] `preparing` 与 `answering` 都提供显式返回 Seed Reference 的产品动作；它不是由 idle、页面后退、刷新或 Seed Surface 选择隐式触发。
- [ ] 返回动作原子地把 current attempt 标记为 abandoned、使该 attempt 的待执行 command 不再可领取，并将 Runtime-owned workflow 恢复到 Seed Reference 登记。
- [ ] 已 abandoned 的 questions、proposed answers、final answers、snapshot 与 command history 保留可审计 identity，但默认 current Alignment read surface 不再返回它们。
- [ ] abandoned attempt 及其 answers 不进入 successful research export，也不能为后续 Design System 提供输入。
- [ ] Agent 对 abandoned 或不再 current 的 attempt 继续提交问题、finalize 或写答案时被拒绝，不能污染新 attempt。
- [ ] 再次点击 `Next phase` 总是基于届时的 Seed Reference collection 创建新 snapshot、attempt 和 `prepare_design_intent_alignment` command；所有六部分问题重新生成。
- [ ] 新 attempt 与旧 attempt 的 lineage 清晰可审计；安全重试返回同一新 attempt，不因网络重试产生多次重开。
- [ ] 状态为 `completed` 的 attempt 不允许返回 Seed Reference 登记，并返回明确的不可逆完成错误。
- [ ] 返回与重新进入只接线现有 navigation 和 surface，不新增或重新设计任何可见 UI；abandoned 状态通过 Runtime/API 与测试语义验证。
- [ ] vertical test 覆盖从 `preparing` 和 `answering` 分别返回、旧 Agent 并发写入被拒绝、重新点击 `Next phase`、新问题集出现，以及 abandoned history 不进入成功导出。

## Blocked by

- `07B-agent-command-alignment-preparation.md`
