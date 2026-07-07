# Rule Update Proposal Confirm/Cancel

## What to build

从 design-system 页面反馈或 prototype region feedback 生成 rule update proposal。Agent 负责解释将改变什么、为什么改变、受影响项；Runtime 记录 proposal canvas/source records；设计师 Confirm 后，Agent 写 design-system source artifact 并声明；Cancel 不修改 source artifact。

此 slice 确保设计师仍是最终决策者，规则递归不会静默污染设计系统。

## User stories covered

- 42, 43, 44, 45

## Acceptance criteria

- [ ] Workbench 能从 design-system context 或 prototype feedback 发起 proposal。
- [ ] `propose_rule_update` 记录 proposal、reason、affected items、linked evidence/feedback。
- [ ] Proposal UI 支持 Confirm 和 Cancel。
- [ ] Confirm 后 Agent 写 source artifact 并调用 `record_artifact_written`。
- [ ] Cancel 不修改 source artifact。
- [ ] 事件日志记录 proposal created、confirmed、canceled。
- [ ] 测试覆盖 confirm path、cancel path、proposal linkage、未声明 artifact guard。

## Real Agent validation

- [ ] 真实 Agent 基于一个真实 prototype region feedback 生成 rule update proposal。
- [ ] 手动 Confirm 后，Agent 写入真实 design-system source artifact 并声明。
- [ ] 手动 Cancel 路径验证不写 source artifact。

## Likely difficulties for Agent

- Agent 可能直接修改设计系统文件，跳过 proposal。
- Proposal 可能过大，把局部例外变成全局规则。
- Confirm 后的文件变更可能与 proposal 不一致。

## Suggested ways through

- Tool/prompt 明确 rule update 必须 proposal-first。
- Proposal schema 要求分类：局部例外、可复用候选、规则冲突、开放缺口、拟议更新或未发现。
- Confirm 后的 `record_artifact_written` 必须关联 proposal id，Runtime 在 export 中保留链路。

## Blocked by

- `08-source-artifact-declaration-validation.md`
- `09-draft-design-system-derived-view.md`
- `11-prototype-region-context-dom-inspection.md`
