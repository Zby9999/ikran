# 六部分 Design Intent Alignment Gate

## What to build

将旧五阶段 seed alignment gate 改为结合 `align-design-intent` Skill 的六部分 Design Intent Alignment。六部分为：Design principle、Visual language、Token、Layout、Component、Interaction。Content style observations 不作为 MVP 必答阶段，也不能阻塞 seed extraction。

Agent 基于 Figma Evidence Surface 和 Region Annotation 创建 Question card。每个部分二到五张卡，卡片包含 Agent observation、Agent question、evidence anchor、conversation thread、可选 `proposed_answer` 和 final answer。设计师在卡片中填写或接受最终答案；开放澄清留在 Agent host chat。

本 issue 同步目标与验收；**不声称已实现完成**。

### 2026-07-10 后续架构收口

Question card 允许 Agent `proposed_answer`。阶段级「接受并继续」：未修改预填答案记为 Agent 提议 / 设计师接受；编辑后的答案记为 designer edited；仍为空则阻止继续。禁止空问题与空 final answer；可填「同意/对」。Answer source 必须可审计。详见 PRD 与 ADR 0002。

### 2026-07-12 Seed Reference collection gate

Alignment 面向项目当前 Seed Reference collection，而不是唯一 seed page。项目级 Design Language Description 为空时不得进入正式 Alignment；每张 Question card 可锚定 collection 中任一 current Figma Evidence Surface。Reference Note 是可选上下文，不是必答 gate。详见 PRD 与 ADR 0003。

## User stories covered

- 15, 16, 17, 18, 19, 20, 21, 22

## Acceptance criteria

- [ ] Workbench 渲染六个 Design Intent Alignment 部分：Design principle、Visual language、Token、Layout、Component、Interaction。
- [ ] Design Language Description 为空时不能进入正式 Alignment；填写一次非空 Description 后整个 Seed Reference collection 可继续，无需逐 Reference 重复填写。
- [ ] Content 不作为必答 gate；缺少 content 问答不阻塞 seed extraction。
- [ ] 每个部分包含二到五张 Question card。
- [ ] 每张 Question card 必须有 evidence anchor，不能只写“这里”。
- [ ] Question card anchor 可指向 collection 中任一 current Figma Evidence Surface，并保留对应 Seed Reference / evidence version linkage。
- [ ] 卡片包含 Agent observation、Agent question、conversation thread；可含 Agent `proposed_answer`；必须有非空 final answer。
- [ ] 禁止空问题与空 final answer；允许「同意/对」等非空短答。
- [ ] 阶段级「接受并继续」：未修改预填 → answer source = Agent 提议 / 设计师接受；编辑后 → designer edited；仍有空答案则阻止继续。
- [ ] 卡片状态只有 unanswered 和 answered。
- [ ] 所有六部分卡片 answered 后，seed extraction 才允许进入 design-system draft。
- [ ] 选择卡片时 Workbench 聚焦对应 Evidence Surface anchor。
- [ ] 测试覆盖六部分计数、answer gate、proposed/final/answer source、Content 不阻塞、anchor validation。

## Real Agent validation

- [ ] 真实 Agent 使用 `align-design-intent` 的证据分桶方法，基于至少两个真实 Seed References 与一个项目级 Description 生成至少一个完整部分的问题卡（可含 proposed_answer）。
- [ ] Mock / automated path 覆盖六部分完整问题集与阶段接受 answer source。
- [ ] 真实验证记录说明 raw Figma data 和 screenshot 是否都可用；与 automated 结果分开记录。

## Likely difficulties for Agent

- `align-design-intent` Skill 默认还包含 Content style observations，Agent 可能继续生成 Content 阶段。
- Agent 可能把 design-system formal rules 提前写入，而不是停留在 alignment questions。
- 六部分问题可能过多，导致 MVP 交互过载。
- Agent 可能留下空 proposed/final answer，或把空串当作“同意”。

## Suggested ways through

- Tool/schema 层只接受六个 allowed section；Content 只能进入 evidence notes 或 open gap，不进入 gate。
- Prompt/tool description 明确此阶段只生成 questions，不写 formal design-system artifacts。
- Schema 拒绝空 question / 空 final answer；阶段接受显式记录 answer source。
- 每部分限制二到五张卡；真实 smoke 允许先覆盖一个部分，mock/e2e 覆盖全量。

## Blocked by

- `05D-retire-agent-evidence-real-smoke.md`
