# Interaction Section 纯文本策略规则与抽取契约拆分

Status: completed

## Parent

- `09C-A-design-system-reader-projection-resizable-split.md`

## What to build

Interaction section 放弃一切生成式视觉（rig / 控件模拟 / state gallery），改为与
foundations/principles 同构的**纯文本规则流**，并在抽取契约层把两类当前混住的
entry 拆开。

背景：原 09C-B 试图为 Interaction 建立统一 visual grammar，两轮 interaction rig
（58f934a、be33f32）与一版 prototype 探索（aac784b，已删除）均不成立。根因是
interaction-rules.json 混住了两个物种：

1. **组件绑定的状态规格**（appliesTo + stateBehavior + motion）——它们是组件规格
   的一部分，脱离组件本体后只能从中性控件反推外观，必然违反「不得猜测外观」；
2. **跨组件的交互策略**（高概念散文规则，如「动效保持克制」「积极使用引导性
   微动效」）——它们没有视觉 anchor，也不需要：价值全在措辞、rationale 与
   use/avoid 中，任何配图都是装饰而非信息。

本 issue 做两件事：

**A. 抽取契约拆分（设计师已定方案 A）**

- `interaction-rules.json` 只承载跨组件交互 / 动效策略（散文类规则）；
- 组件绑定的状态规格在抽取时归入对应 component spec 的 `states` / `motion`
  字段，entry 粒度在抽取时切对，不在 projection 层做猜测性分类；
- 更新 09C-B01 确立的写作风格契约，使 Agent 在抽取时可见这一边界（什么进
  interaction-rules、什么进 component spec）；
- 历史已抽取项目按新契约重写（同 09C-B02 的做法）。

**B. Interaction section 纯文本化**

- 页面形态与 foundations/principles 同属纯文本规则语言：meaning、Description、
  Behavior、Accessibility、
  status chip、candidate 审批与 evidence popover 在原路径上保持可用；
- 退役 `InteractionRigBlock` / `InteractionMiniSpecimen` / `InteractionUnavailable`
  与 `appliesTo → control` adapter 推断（`INTERACTION_ADAPTER_STATES` /
  `INTERACTION_ADAPTER_REQUIRED_STATES` 及 projection 中的 control / origin 推导）；
- `InteractionRuleProjection` 简化为纯文本规则投影，保持确定性、可测试、可追溯；
- 右栏不再为 Interaction 生成任何视觉样本；策略规则即完整呈现，不显示
  「 unavailable 」式空洞占位。

## Locked product decisions

- Interaction section 呈现**策略**，策略的诚实呈现形式是**文本**；这不是降级，
  是「不生成没有 source 支持的装饰性样本」原则的必然推论。
- 组件的交互行为是**组件规格**，归组件页面呈现（09C-D03），Interaction section
  不再代为展示。
- 分类发生在**抽取契约层**（方案 A），不在 Browser projection 层做启发式拆分。
- candidate / formalized / gap、审批写回与 evidence lineage 语义不变。
- Projection 仍为确定性 derived presentation model；不调用模型改写文案。

## Acceptance criteria

- [x] 抽取契约（含 09C-B01 写作风格契约）明确 interaction-rules 只承载跨组件
      策略，组件绑定状态规格归入 component spec 的 states / motion
- [x] ikran test 7 已有抽取产物按新契约重写，两类 entry 各归其位
- [x] Interaction leaf 渲染为纯文本 Ledger 规则流，点击行展开详细信息
- [x] interaction rig、control adapter 推断及相关 CSS 全部移除，无残留引用
- [x] status、approval、evidence popover、Technical details 行为无回归
- [x] 新 projection 与契约拆分有确定性 unit tests；e2e 与真实 Browser 核对
      与 09C-A 既有验证分开记录

## Blocked by

- 无（09C-B01 / 09C-B02 已完成）

## Out of scope

- 不做任何 Interaction 级 visual grammar、state strip 或控件模拟。
- 不建设组件页面（属 09C-D03）；组件绑定规格在本 issue 只完成抽取归位。
- 不把 motion 参数 token 化。
- 不改变 candidate / formalized / gap 资格语义。

## Comments

### 2026-08-01 — 方向决策（取代 09C-B 的 Interaction 部分）

设计师与 Agent 讨论后确认：原 09C-B「统一 Interaction visual grammar」目标取消
——问题不是被解决而是被解散。Interaction 数据分为组件绑定规格（归组件页）与
高概念策略（纯文本）两类；分类在抽取契约层完成（方案 A）。原 09C-B 文件已删除，
完整讨论与验收历史可从 git 历史取回。

### 2026-08-01 — Ledger 晋升与字段定名

设计师确认采用 Ledger 方向，并将原型中语义含混的 Rationale / Use / Avoid
定名为 Description / Behavior / Accessibility。生产投影与抽取契约使用这三个
字段；Behavior 与 Accessibility 为短约束句列表，Description 为一段简短说明。

真实 Browser 已在 `ikran test 7` 核对：Interaction 默认呈现折叠 Ledger 行，点击
后即时展开三组详情与 evidence 入口；页面不再包含 split pane、rig 或 unavailable
占位。自动验收单独由 unit、reader e2e 与全量 `npm run check` 覆盖。
