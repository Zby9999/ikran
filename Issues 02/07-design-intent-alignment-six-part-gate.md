# 六部分 Design Intent Alignment Gate

## What to build

将旧五阶段 seed alignment gate 改为结合 `align-design-intent` Skill 的六部分 Design Intent Alignment。六部分为：Design principle、Visual language、Token、Layout、Component、Interaction。Content style observations 不作为 MVP 必答阶段，也不能阻塞 seed extraction。

Agent 基于 Figma Evidence Surface 和 Region Annotation 创建 Question card。每个部分二到五张卡，卡片包含 Agent observation、Agent question、evidence anchor、conversation thread 和 final designer answer。设计师在卡片中填写最终答案；开放澄清留在 Agent host chat。

## User stories covered

- 15, 16, 17, 18, 19, 20, 21, 22

## Acceptance criteria

- [ ] Workbench 渲染六个 Design Intent Alignment 部分：Design principle、Visual language、Token、Layout、Component、Interaction。
- [ ] Content 不作为必答 gate；缺少 content 问答不阻塞 seed extraction。
- [ ] 每个部分包含二到五张 Question card。
- [ ] 每张 Question card 必须有 evidence anchor，不能只写“这里”。
- [ ] 卡片包含 Agent observation、Agent question、conversation thread、final designer answer。
- [ ] 卡片状态只有 unanswered 和 answered。
- [ ] 所有六部分卡片 answered 后，seed extraction 才允许进入 design-system draft。
- [ ] 选择卡片时 Workbench 聚焦对应 Evidence Surface anchor。
- [ ] 测试覆盖六部分计数、answer gate、Content 不阻塞、anchor validation。

## Real Agent validation

- [ ] 真实 Agent 使用 `align-design-intent` 的证据分桶方法，为真实 seed page 至少生成一个完整部分的问题卡。
- [ ] Mock path 覆盖六部分完整问题集。
- [ ] 真实验证记录说明 raw Figma data 和 screenshot 是否都可用。

## Likely difficulties for Agent

- `align-design-intent` Skill 默认还包含 Content style observations，Agent 可能继续生成 Content 阶段。
- Agent 可能把 design-system formal rules 提前写入，而不是停留在 alignment questions。
- 六部分问题可能过多，导致 MVP 交互过载。

## Suggested ways through

- Tool/schema 层只接受六个 allowed section；Content 只能进入 evidence notes 或 open gap，不进入 gate。
- Prompt/tool description 明确此阶段只生成 questions，不写 formal design-system artifacts。
- 每部分限制二到五张卡；真实 smoke 允许先覆盖一个部分，mock/e2e 覆盖全量。

## Blocked by

- `06-evidence-surface-region-annotation-slice.md`
