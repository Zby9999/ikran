# 27 — Completion-Time Conversation Reconciliation

Status: implemented（Real Agent validation 待做）

> **2026-08-08 真实测试修订**：原“每达成一个修改结论立即调用 Agent 工具落库”在真实 Agent host 中不可靠。Agent turn 被设计师插话打断时，尚未发生的工具调用会丢失；下一轮又可能只总结最后一条插话。因此正常路径改为：活动设计对话中不写语义 feedback；设计师明确完成 Prototype 或发起 Rule Update 时，冻结完整消息范围并一次性对账落库。

## What to build

设计师与 Agent 的开放交互留在 Agent host chat（沿用 Issue 07 决策：Workbench 不加通用 chat/thread UI）。原始对话由 Agent host 提供；到明确完成节点，Agent 调用 `reconcile_designer_conversation`，提交一个带稳定消息边界的完整 transcript snapshot 与结构化 decision ledger。Runtime 在同一事务内保存 reconciliation、批量 `designer_feedback` 和事件。

核心语义:**交互信息只有两种命运——在当下对话里指导当下设计(易失,随会话结束天然消失),或经设计师审查被提升为 Design System Rule(持久,唯一的长效影响)**。反馈库本身永远不是生成输入,只是审查素材。

由此产生四条硬边界:

- **活动对话零语义写入**：Agent 不在活动设计 turn 中调用 `record_designer_feedback`。旧工具只保留为历史兼容/已结束记录导入口，不是正常流程。
- **完成节点对账**：仅在设计师明确确认 Prototype、说设计完成，或发起 Rule Update 时冻结 `conversationId + startMessageId + endMessageId`，提交完整有序 transcript 与 decision ledger。
- **原话优先**：每条 decision 必须引用范围内至少一条 designer-authored message；Agent 建议不能独立成为事实。后续明确纠正标为最终决定，被覆盖结论标为 `superseded`。
- **生成隔离**:设计生成链路(包括新设计 run,见 Issue 13)的任何工具不得暴露反馈库读取入口。只有正式进入 Design System source 的信息才能影响新设计决策——反馈想影响未来设计,唯一路径是经 Issue 29 审查提升为 Rule。

Runtime 无法硬禁止宿主 Agent 直接读 `.ikran/` 文件,生成隔离的 enforcement 分三层:生成链路工具不提供反馈读取入口;`IKRAN_MCP_INSTRUCTIONS` 增加行为底线;物理分离(反馈存 `.ikran/`,`design-system/` 目录只放已提升的 Rule)。

## 记录契约

- reconciliation 携带 caller 提供的稳定 `reviewId`、conversation/run/session id、首尾 message id、完整 ordered transcript、Runtime 计算的 SHA-256、消息数、决定数与完成时间。
- decision disposition 为 `final_decision / superseded / local_exception / open_gap`；每条携带 summary、source message ids、可选 linkage 与 opaque context。
- `reviewId` 是幂等键：相同内容重放返回原结果且不重复写记录；相同 id 携带不同内容硬拒绝。相同会话范围也不能用不同 id 重复提交。
- transcript、reconciliation、全部 feedback 与 `conversation_reconciliation_completed` 在同一事务中写入；任一 provenance/linkage 校验失败则全部不落库。
- Runtime 校验:声明的 linkage id 若给出,必须存在于对应记录表(校验范畴与 `propose_rule_update` 的 evidence 校验一致);伪造 id 拒绝。
- `designer_feedback` 记录加入 rule update proposal 的 evidence 校验白名单(Issue 22 落地的五类之外新增一类)。
- 原始 transcript 只用于审计/对账，不进入 design generation，也不默认进入 research export。

## User stories covered

- 42, 43, 44

## Acceptance criteria

- [x] 新增 `reconcile_designer_conversation` MCP 工具，接收冻结消息范围、完整 transcript 与 decision ledger。
- [x] Runtime 强制 decision 引用 designer-authored message，并保留 final/superseded/local/open-gap 状态与 source ids。
- [x] reconciliation 与整批 feedback 原子提交；相同 `reviewId` 幂等重放，内容冲突硬拒绝。
- [x] 伪造 linkage id 的声明被拒绝。
- [x] `designer_feedback` 进入 `propose_rule_update` 的 evidence id 校验白名单。
- [x] 设计生成链路的工具与上下文 payload 不包含反馈库读取入口。
- [x] `IKRAN_MCP_INSTRUCTIONS` 明确活动对话不写语义 feedback，完成节点必须先 reconciliation 再 Consolidate。
- [x] 单元测试覆盖：范围冻结、designer provenance、被推翻决定、空决定、幂等重放；MCP 测试覆盖 reconciliation → Consolidate 纵向链路。

## Real Agent validation

- [ ] 真实 Agent 经多轮 chat、一次中途插话打断和一次后续纠正后，在完成节点提交完整 reconciliation；最终与被推翻决定均可追溯到原 message id。
- [ ] Agent 在工具成功但回复被打断后，以同一 `reviewId` 重放，不产生重复 feedback/event。
- [ ] 未发起审查时,真实 Agent 在新设计任务中不读取反馈库(通过任务上下文与工具边界验证)。

## Likely difficulties for Agent

- Agent host 若不能提供完整 transcript 或稳定 message id，只靠模型当前上下文仍会受压缩/截断影响；该 host 不能宣称强保证。
- Agent 只提交最后一条插话而不是完整冻结范围；Runtime 能验证边界自洽，但不能证明宿主遗漏了未提供的消息。
- Agent 把自己的建议当作 designer 决定；Runtime 通过 designer-authored source 最低门槛阻止纯 Agent 结论，但最终语义仍需 Proposal Confirm。
- Agent 在生成新设计时主动读 `.ikran/` 下的反馈记录文件——Runtime 无法硬禁止,只能靠工具边界 + instructions + 目录分离约束。

## Suggested ways through

- Host adapter 应提供不可变 transcript snapshot 与稳定 message ids；缺少该能力时明确降级为 best effort。
- `confirm_prototype` 的 next contract 固定为 `reconcile_designer_conversation → claim_consolidate_review(reconciliationId)`。
- 不增加第二次人工确认；decision ledger 是审计材料，现有 Rule Proposal Confirm 仍是唯一写全局规则的人类确认。
- 反馈记录写路径与 design-system source 读路径物理分离(`.ikran/` vs `design-system/`)。

## Blocked by

- `08-source-artifact-declaration-validation.md`
