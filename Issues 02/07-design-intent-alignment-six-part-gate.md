# 六部分 Design Intent Alignment Gate

## What to build

将旧五阶段 seed alignment gate 改为结合 `align-design-intent` Skill 的六部分 Design Intent Alignment。六部分为：Design Concept、Visual language、Token、Layout、Component、Interaction。Content style observations 不作为 MVP 必答阶段，也不能阻塞 seed extraction。

Agent 基于 Figma Evidence Surface 和 Region Annotation 创建两类可视卡片：

- 灰色 Agent Annotation：承载 `align-design-intent` 中 Confirmed from design 与 Reasonable inference。两类在 Workbench 中不做视觉区分，默认供设计师浏览，也允许点击后附加或编辑信息；它们不是必答问题，不参与 Question coverage，但六个部分各自至少必须有一张，否则不能结束 preparation。
- 六部分阶段色 Question card：承载 Open questions / undecided。每个部分二到五张，包含简短标题（wire/storage 兼容字段仍为 `observation`）、Agent question、evidence anchor、可选 `proposed_answer` 和 final answer。标题应为 2–5 个词的有效名词短语，不得写成句子或重复问题，且最长 48 个字符。开放澄清留在 Agent host chat；Workbench 只需保证设计师提交的回答被 Runtime 持久化并可由 Agent 持续读取。

两类卡片都是强制 preparation 输出并绑定当前 Alignment attempt 与所属部分。每个部分必须先由 Agent 写出该部分的灰色 Annotation，再提出需要设计师确认的彩色 Question cards，随后才推进到下一部分；一张 Annotation 不得跨部分复用。两类卡片都支持特定 node/region、整个 Frame surface、复用元素 focus-target-set 三种 evidence anchor。Agent 不得只提问而隐藏已有假设，不得把已有假设伪装成彩色 Question card，也不得把真正的不确定性写成灰色已确认判断。只有六部分都具备各自的灰色 Agent Annotation 与完整 Question cards，Runtime 才允许进入回答阶段。

具体 UI、颜色和交互以设计师 Figma 为准：主参考 `97:740`，阶段面板 states `269:211`，Question card variants `155:273`，多处/跨 Frame focus mode `177:426`。

本 issue 同步目标与验收；**不声称已实现完成**。

### 2026-07-10 后续架构收口

Question card 允许 Agent `proposed_answer`，但它只用于预填编辑器，不代表已回答，也不提供阶段 coverage。设计师必须逐卡点击发送，即使不修改默认回答：未修改预填的显式提交成为 final answer，answer source = Agent 提议 / 设计师接受；编辑后提交的答案成为 final answer，answer source = designer edited。全局 `Complete` 只在六部分所有卡片都已有非空 final answer 后可用；它结束整个 Alignment 并进入 Draft Design System，不会自动接受 proposed answer，也不承担逐阶段推进。禁止空问题与空 final answer；可填「同意/对」。Answer source 必须可审计但不显示在 UI。详见 PRD 与 ADR 0002。

### 2026-07-12 Seed Reference collection gate

Alignment 面向项目当前 Seed Reference collection，而不是唯一 seed page。项目级 Design Language Description 为空时不得进入正式 Alignment；每张 Question card 可锚定 collection 中任一 current Figma Evidence Surface。Reference Note 是可选上下文，不是必答 gate。详见 PRD 与 ADR 0003。

## User stories covered

- 15, 16, 17, 18, 19, 20, 21, 22

## Acceptance criteria

- [ ] Workbench 渲染六个 Design Intent Alignment 部分：Design Concept、Visual language、Token、Layout、Component、Interaction。
- [ ] Design Language Description 为空时不能进入正式 Alignment；填写一次非空 Description 后整个 Seed Reference collection 可继续，无需逐 Reference 重复填写。
- [ ] Content 不作为必答 gate；缺少 content 问答不阻塞 seed extraction。
- [ ] Confirmed from design 与 Reasonable inference 均投影为同一灰色 Agent Annotation 卡；可编辑/附加信息，不进入 Question 必答计数；六部分各自至少一张，否则 create Question 或 finalize 返回 `section_annotation_required`。
- [ ] Runtime 强制每部分先创建灰色 Agent Annotation，再创建该部分的彩色 Question cards；两类都绑定当前 attempt 与 section，缺少任一类都不能进入 answering。
- [ ] 灰色 Agent Annotation 与 Question card 一样支持 node/region、whole Frame surface、focus-target-set 三种投影形式；Workbench 只显示当前部分的 Annotation，且排在该部分 Question cards 之前。
- [ ] 每个部分包含二到五张 Question card。
- [ ] 每张 Question card 必须有 evidence anchor，不能只写“这里”。
- [ ] Question card anchor 可指向 collection 中任一 current Figma Evidence Surface，并保留对应 Seed Reference / evidence version linkage。
- [ ] 单一具体元素或组件优先使用 positional evidence 中的明确 node target；只有没有准确节点可表达目标时才使用 region。以 Annotation 直接标记目标，并从目标水平引出 Question card，不得用手工估算 region 代替已有节点。
- [ ] 多次出现或多个组件共享的元素（如颜色、字体）使用显式 focus target set；Hover 或点击 Question card 后进入 Focus Mode，所有目标保持高亮、其他区域压暗，不显示虚线/普通 Annotation，也不强制移动镜头。
- [ ] 针对整个 Frame 的问题必须使用显式 surface target，只显示 Question card，不生成 Annotation、覆盖框或虚线；不得用接近全幅的 region 模拟 surface。
- [ ] 卡片包含 2–5 个词、最长 48 字符的简短标题与 Agent question；标题不是句子且不重复问题。可含 Agent `proposed_answer`；Alignment 完成时必须有非空 final answer。开放 conversation 留在 Agent host chat，不在 Workbench 增加通用 chat/thread UI。
- [ ] 禁止空问题与空 final answer；允许「同意/对」等非空短答。
- [ ] 设计师提交或修改答案后 Runtime 立即持久化并广播 record invalidation；Agent 可通过语义 MCP read surface 获取最新 Agent Annotations、Question cards 与 answers。
- [ ] 设计师逐卡点击发送：未修改预填 → answer source = Agent 提议 / 设计师接受；编辑后提交 → answer source = designer edited。
- [ ] 只有非空 final answer 计入 coverage；仅有 proposed answer 的卡片保持 unanswered，所属部分不得显示完成对号；六部分 coverage complete 前全局 `Complete` disabled。
- [ ] 六部分可自由切换、提前进入和回看；阶段面板默认只显示当前部分，hover/focus 展开全部阶段与全局 `Complete`。
- [ ] 卡片状态只有 unanswered 和 answered。
- [ ] 全局 `Complete` 不接受或提升 proposed answers；只有所有六部分卡片已通过逐卡发送形成非空 final answer 后，seed extraction 才允许进入 design-system draft。
- [ ] Question card 收起宽度为 320px；卡片与所关联 Seed Reference 的布局间距为 20px；展开、已回答和阶段配色遵循 Figma variants。
- [ ] 点击普通 node/region anchor 卡片时只展开编辑器，保留原位 Annotation 与水平虚线，不选择目标、不改变镜头位置；Hover 或点击 focus target set 卡片时进入 focus mode，同样不改变镜头位置。再次点击当前 focus card 保持 focus；点击另一卡切换目标；点击画布空白或按 `Esc` 退出；遮罩只做短淡入淡出，不循环闪烁。
- [ ] 测试覆盖六部分计数、双卡种 preparation gate、attempt-bound Agent Annotation、coverage/global Complete gate、proposed/final/answer source、Content 不阻塞、single/focus-set anchor validation、answer read surface 与 focus-mode 退出规则。

## Real Agent validation

- [ ] 真实 Agent 使用 `align-design-intent` 的证据分桶方法，基于至少两个真实 Seed References 与一个项目级 Description 生成至少一个完整部分的问题卡（可含 proposed_answer）。
- [ ] Mock / automated path 覆盖六部分完整问题集、自动 coverage、全局 Complete 与 answer source。
- [ ] 真实验证记录说明 raw Figma data 和 screenshot 是否都可用；与 automated 结果分开记录。

## Likely difficulties for Agent

- `align-design-intent` Skill 默认还包含 Content style observations，Agent 可能继续生成 Content 阶段。
- Agent 可能把 design-system formal rules 提前写入，而不是停留在 alignment questions。
- 六部分问题可能过多，导致 MVP 交互过载。
- Agent 可能留下空 proposed/final answer，或把空串当作“同意”。
- 多处/跨 Frame focus target set 需要显式 evidence version linkage，不能退化成只有视觉遮罩、没有可审计 target 的 UI 状态。

## Suggested ways through

- Tool/schema 层只接受六个 allowed section；Content 只能进入 evidence notes 或 open gap，不进入 gate。
- Prompt/tool description 明确此阶段只生成 questions，不写 formal design-system artifacts。
- Schema 拒绝空 question；全局 Complete 拒绝任何无法形成非空 final answer 的卡片，并显式记录 answer source。
- 每部分限制二到五张卡；真实 smoke 允许先覆盖一个部分，mock/e2e 覆盖全量。

## Blocked by

- `05D-retire-agent-evidence-real-smoke.md`

## Completion report — 2026-07-23

完成本 issue 中 Agent Annotation 的 section-bound 修正：Runtime/MCP 现在强制六个部分各自遵循 `Agent Annotation → Question cards`，禁止跨部分复用灰卡，也禁止在该部分 Question 已开始后补建灰卡。灰卡与 Question 均支持 node/region、whole-surface、focus-target-set 三种 evidence anchor；Workbench 只投影当前部分，并将灰卡排在彩色 Question 之前。数据库 schema 已迁移至 v13，旧记录以 `section: null` 保持可读但不满足新 gate。

验证结果：

- `npm run check`：73 个测试文件、530 个单元/集成测试及 71 个 Browser Use/Playwright 测试全部通过。
- `npm run build`：production build 通过；`git diff --check` 通过。
- 独立 Codex 线程使用隔离的临时 Runtime、Ikran MCP 与真实 Workbench 验证：无本节灰卡时 Question 返回 `section_annotation_required`；六部分分别生成 1 张灰卡与 2 张 Question；node/region 显示 target + connector，whole-surface 只显示卡片，focus-target-set 点击后生成包含两个 captured node rect 的 active Focus Mask；`finalize_alignment_preparation` 最终进入 `alignment-answering`。
- 独立验证的后台标签页未能稳定复现原生 pointer hover，click Focus Mode 已通过真实 Browser Use，hover 行为另由自动化浏览器测试覆盖。
- 验证结束后已关闭临时 Workbench/Runtime/MCP，确认测试端口无监听，并删除临时 project、state、构建副本及 panic/test artifacts。
