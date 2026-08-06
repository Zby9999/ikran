# 29 — 批量 Rule Update 审查(设计师择机 Consolidate)

Status: ready-for-agent

> **修订记录(2026-08-06,演示路线变更)**:为优先交付**无 UI 的端到端纵切**,本 issue 拆为两个 slice:
>
> - **MVP(chat 口述路径,先行)**:审查不由 Workbench UI 承载。设计师在 chat 发起 Consolidate;Agent 全量读反馈库、聚合并按分类学分类后,**只在 chat 口述"拟提升为全局规则"的提案**(六分类中的可复用候选 / 拟议更新;局部例外、冲突登记、开放缺口、无发现作为交互记录去向保留在事件与反馈记录中,设计师可在 chat 按需查询,不默认口述)。Confirm/Cancel 也在 chat 表达、Agent 声明落库。**proposal-first、confirm 前禁写 artifact、artifact 关联 proposal id、完整性不变量(每条反馈有去向)等硬边界不变。**
> - **UI slice(推迟)**:Workbench 审查面板,设计已定稿为"收录优先"双层结构(默认层只放写入全局规则的提案 + 折叠的全部交互记录审计层),交互原型见 `app/prototypes/review-session/` 的 Intake 变体。端到端纵切完成后按此原型补齐。原 AC 中标注【UI】的条目归此 slice。

## What to build

Rule update 的提案时机由设计师选择,不是每次交互后即时提案。交互中修改结论即时落库(Issue 27);设计师择机发起**审查时刻(Consolidate)**,Agent 全量读取反馈库,按 run/session 分组与 linkage 聚合(同一 surface/component 的多轮反馈合并为一个提案,被推翻的中间决定以最新为准),按完整分类学分类后**批量起草 proposals**;设计师逐条 Confirm/Cancel。

分类学沿用 Issue 12 / workflow skill 的六类:局部例外、可复用候选、规则冲突、开放缺口、拟议更新、无发现。

硬边界(继承 Issue 12,Runtime 硬校验):

- Confirm 后 Agent 才写 design-system source artifact,且 `record_artifact_written` **必须关联 confirmed proposal id**;Cancel 不修改任何 source artifact。
- Proposal 记录 reason、affected items、classification、linked evidence(evidence id 可为 Issue 27 的 feedback 记录或既有五类)。
- 事件日志记录 proposal created / confirmed / canceled,导出保留链路(Issue 15)。

两个补充机制:

- **即时逃生口**:设计师在 chat 明确"这条现在就定为规则"时,可走单条即时提案(同一 `propose_rule_update` 通道,同样先 Confirm 再生效)。批量是默认节奏,不是强制。
- **软提醒**:Workbench 状态区显示待审查反馈计数,提醒设计师择机审查;**绝不自动触发**审查——时机权始终在设计师。

本 issue 取代 `12-rule-update-proposal-confirm-cancel.md`(已标记 superseded):原 issue 的 proposal-first、Confirm/Cancel、artifact 关联等核心契约全部继承,变化的是提案起草时机(设计师择机的批量审查)与 evidence 来源(chat-first 落库的 feedback 记录)。

## User stories covered

- 42, 43, 44, 45

## Acceptance criteria

标注:【MVP】= chat 口述路径(先行);【UI】= Workbench 审查面板(推迟,按 Intake 原型补齐)。

- [ ] 【MVP】设计师在 chat 发起 Consolidate 审查;发起前反馈库只写不读。【UI】另增 Workbench 发起入口。
- [ ] 【MVP】发起后 Agent 全量读取反馈库,按分组与 linkage 聚合,批量起草 proposals(含分类、reason、affected items、linked evidence)。
- [ ] 【MVP】被后续反馈推翻的中间决定不单独成提案,以最新决定为准。
- [ ] 【MVP】chat 口述只呈现拟提升为全局规则的提案(可复用候选 / 拟议更新);其余分类的去向可在 chat 按需查询。
- [ ] 【MVP】Confirm / Cancel 在 chat 表达,Agent 经声明命令落库。【UI】Proposal 面板逐条 Confirm / Cancel。
- [ ] 【MVP】Confirm 后 Agent 写 source artifact 并 `record_artifact_written` 关联 proposal id;Runtime 校验关联,缺失拒绝。
- [ ] 【MVP】Cancel 不修改 source artifact。
- [ ] 【MVP】支持 chat 明确指示的单条即时提案(逃生口),同样 Confirm 才生效。
- [ ] 【UI】Workbench 状态区显示待审查反馈计数;无任何自动触发。
- [ ] 【MVP】事件日志记录 proposal created / confirmed / canceled。
- [ ] 【MVP】测试覆盖:批量起草与聚合、confirm path、cancel path、artifact-proposal 关联校验、未确认 artifact guard、逃生口。

## Real Agent validation

- [ ] 真实 Agent 在一次 Consolidate 中把多轮真实反馈聚合成批量 proposals,设计师逐条 Confirm/Cancel。
- [ ] 手动 Confirm 后,Agent 写入真实 design-system source artifact 并声明,声明关联 proposal id。
- [ ] 手动 Cancel 路径验证不写 source artifact。

## Likely difficulties for Agent

- Agent 直接修改设计系统文件,跳过 proposal。
- 聚合不当:一个提案过大(局部例外变全局规则),或已被推翻的决定也进了提案。
- Confirm 后的文件变更与 proposal 不一致。
- Agent 在未被发起时主动读取反馈库或自动发起审查。

## Suggested ways through

- Tool/prompt 明确 rule update 必须 proposal-first;confirm 前禁止写 source artifact 由 Runtime 硬校验兜底。
- 提案按落库时的 run/session 分组与 linkage 聚合,不靠事后语义聚类。
- Confirm 后的 `record_artifact_written` 必须关联 proposal id,Runtime 在 export 中保留链路。
- 待审查计数只是展示,审查入口只响应设计师显式发起。

## Blocked by

- `27-chat-first-designer-feedback-declaration.md`
- `08-source-artifact-declaration-validation.md`
- `09-draft-design-system-derived-view.md`
