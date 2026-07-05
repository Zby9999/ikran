# D09 New Prototype Creation

## 对应实现 Issue

- `10` - Human-Intent 新原型创建
- `11` - 可选 Visual-Reference 新原型创建
- `07` - Seed Prototype Scaffold 与实时预览
- `09` - 上下文 Rule-Update Proposal 流程

## 设计顺序

第 9 个设计。  
它发生在 seed startup 和 Design System browser 之后，是 MAP 的长期主循环。必须先知道 design system 如何被浏览、preview 如何工作，才能设计新 prototype creation。

## 页面目标

让设计师从 human intent 创建新的 prototype，并可选提供一个 visual reference。  
默认路径应该是 human-intent-first，因为 PRD 的研究重点是从 aligned design language 生成新设计，而不是只复刻参考图。
生成后应进入 Prototype Evidence Surface review，支持整体 feedback 和局部 region feedback。

## 页面结构

- 左侧流程区：
  - New prototype。
  - Recent prototype runs。
  - Rule recursion entry。

- 中心区域：
  - intent input。
  - optional visual reference input。
  - selected design-system context summary。
  - generation status。
  - generated Prototype Evidence Surface 或进入 preview 的状态。

- 右侧 Agent/sidebar：
  - agent questions if needed。
  - current run summary。
  - feedback input。
  - possible rule-update implication。

## 输入结构

- Prototype goal。
- User/task context。
- Desired page/surface type。
- Optional visual reference。
- Constraints or exclusions。
- Submit / generate。

## 关键状态

- Empty new prototype form。
- Human intent filled。
- Optional visual reference attached。
- Agent generating。
- Prototype generated。
- Designer feedback submitted。
- Rule-update candidate detected。

## 设计注意

- visual reference 是 optional，不要让它变成主流程。
- 页面不应像 generic AI app builder；它是在现有 design system 内创建 prototype。
- generation 后应自然进入 live preview/review，而不是停留在表单。
- feedback 是当前 prototype 的反馈，不应立即变成 formal rule。
- 局部 feedback 应使用 prototype region anchor；无局部区域时绑定当前 prototype surface/run。

## 需要交付的设计稿

- empty form。
- filled human-intent form。
- optional visual-reference attached。
- generating 状态。
- generated with preview 状态。
- feedback submitted 状态。
