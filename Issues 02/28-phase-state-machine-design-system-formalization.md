# 28 — Phase State Machine 与 Design System 正式化

Status: resolved

## What to build

Runtime 维护项目相位状态机,覆盖 seed 之后的完成链路:

```
seed → draft_design_system(待审计) → prototype_validation → design_system_formal(DS v1) → ready_for_new_design
```

每次相位转换由设计师在 chat 中表达,Agent 通过 MCP 命令声明,Runtime **硬校验声明顺序**并记录语义事件。新增三个声明命令:

- `confirm_draft_design_system` — 设计师完成 Draft DS 审计,解锁第一个 Prototype 生成。
- `confirm_prototype` — 设计师确认 Prototype 修改与审计通过。
- `formalize_design_system` — DS 正式化为 v1,项目进入 ready_for_new_design。

关键语义:**Draft DS 只有被用来产出并审计通过第一个 Prototype 后才算被验证**——抽取阶段审计只能验证规则忠实于 seed,验证不了规则足以生成正确的新东西,第一个 Prototype 是 Draft 的验收测试。因此:

- **正式化不是单纯状态翻转**:它 = 第一次批量 Rule Update(把 prototype 迭代期间经 Issue 27 落库的反馈回流折进规则,复用 Issue 29 的批量审查机制,全部 Confirm 后)+ DS v1 状态翻转。正式化的 DS v1 必须与刚审计通过的 Prototype 一致。
- **Candidate 的裁决点**:DS 条目分 Formalized(设计师确认,生成硬参考)与 Candidate(未确认,低优先级软参考,冲突时 Formalized 优先)两级。正式化时,通过 prototype 验证的 Candidate 转为 Formalized;未裁决的 Candidate 保持软参考地位,不得无限积压。
- **Prototype 迭代期间的修改必须经 Agent 之手**(设计师在 chat 指示、Agent 改代码、反馈照常落库);设计师不直接改 prototype 文件,否则正式化时的回流审查会漏。
- **回退路径**:Prototype 审计暴露 Draft 根本性问题时,可声明退回 seed/extraction 阶段(abandon 语义事件),状态机不假装线性。
- 硬校验只管**声明顺序**(未 confirm draft 不能 record prototype;未 confirm prototype 不能 formalize;未 formalize 不能开新设计 run),不管文件本身——与现有 evidence 校验边界一致。研究导出(Issue 15)的有效性依赖这个事件序列。

## User stories covered

- 33, 34, 39, 41

## Acceptance criteria

- [x] Runtime 持久化项目相位,相位转换经声明命令驱动并记录语义事件。
- [x] `confirm_draft_design_system` / `confirm_prototype` / `formalize_design_system` 三个命令按上述语义实现。
- [x] 乱序声明被拒绝(未 confirm draft 声明 record prototype、未 confirm prototype 声明 formalize、未 formalize 声明新设计 run)。
- [x] `formalize_design_system` 前置一次完成的批量 Rule Update 审查(Issue 29):存在待审查反馈时不得直接 formalize。
- [x] 支持退回 seed/extraction 的回退声明与事件。
- [x] Workbench 状态区显示当前相位。
- [x] 测试覆盖:正常相位链、乱序拒绝、回退路径、formalize 前置审查门槛。

## Real Agent validation

- [x] 真实 Agent 走完整链路:设计师 chat 确认 draft → 生成并迭代 prototype → 设计师确认 → 批量审查回流 → formalize,事件日志相位序列完整。
- [x] 真实 Agent 在 draft 未确认时尝试 record prototype 被拒。

> 2026-08-06 `ikran test 7` MCP 验证 PASS（`b397009`）:相位链 B1–B8（含未审反馈门；消费用 SQL 模拟 Issue 29）；乱序 formalize@draft → `phase_gate`（`record_preview` 属 Issue 30，尚未接线）；Workbench `data-project-phase` / readiness 同步到 `ready_for_new_design`；abandon 按计划跳过。报告见 `/tmp/ikran-issue28-test7-report.md`。

## Likely difficulties for Agent

- Agent 把 formalize 当成纯状态翻转,跳过反馈回流审查。
- 设计师绕过 Agent 直接改 prototype 文件,Agent 不知情,回流审查漏掉这些修改。
- 相位机被实现成线性流程,无法表达回退。

## Suggested ways through

- `formalize_design_system` 命令在存在待审查反馈时直接拒绝,并返回待审查计数,引导先走 Issue 29 审查。
- 工具描述明确"prototype 修改必须经 Agent 之手";设计师直接改文件属流程外行为,不为此造检测机制。
- 相位转换用显式事件建模(含 abandon/return 事件),不用单向状态枚举推进。

## Blocked by

- `27-chat-first-designer-feedback-declaration.md`(反馈落库是 formalize 回流的输入)
- `29-batch-rule-update-review.md`(formalize 复用批量审查机制)

## Notes

- 2026-08-07: 相位现可被 Agent 读取:`get_project_readiness` 的 structuredContent 返回 `projectPhase` 与 `seedReferenceCount`,`create_or_open_project` 成功载荷携带 `project_phase`。注意:相位仍是声明序状态(declaration-order state),不是画布事实状态(canvas-fact state)——它记录 Agent/设计师声明到哪一步,不验证画布上真实发生了什么。
