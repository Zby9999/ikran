# Component Reader 与统一呈现框架（含组件绑定交互规格）

Status: needs-info

## Parent

- `09C-A-design-system-reader-projection-resizable-split.md`

## What to build

建立统一 Component Reader 与 presentation contract，把所有 component spec 投影为
可读、可审计的组件页面。组件绑定的交互规格（states / motion，由 09C-D01 在
抽取层归位）作为组件规格的一部分在本页面呈现——在确定的组件上下文里，状态与
动效参数是规格表，不需要猜测。

**布局前提（2026-08-03 修订）**：09C-A 已整体退役左右分栏。启用本 issue 时须按
**全宽单栏**重新设计模块放置——原「左栏规格 / 右栏视觉」假设作废；规格字段组与
视觉模块（Source capture、preview、gallery 等）在同一全宽页面内分区编排，对齐
Type Atlas / Layout placard，不再恢复右栏。

本 issue 继承原 09C-B 的 Component Framework 部分（原文件已删除，讨论与验收
历史可从 git 历史取回）：

- ~~左栏按 Purpose、Anatomy、Variants、Sizes、States、Properties、Token links、
  Usage rules、Content rules、Responsive behavior、Code links、Open gaps、Status
  和 Evidence 分组；空字段不显示成噪声，omission / not-applicable 仍可从
  Technical details 与 extraction lineage 审计；~~
- 规格区按 Purpose、Anatomy、Variants、Sizes、States、Properties、Token links、
  Usage rules、Content rules、Responsive behavior、Code links、Open gaps、Status
  和 Evidence 分组（全宽页面内的阅读区）；空字段不显示成噪声，omission /
  not-applicable 仍可从 Technical details 与 extraction lineage 审计；
- ~~右栏视觉模块按当前组件适用性选择：default specimen、interactive preview、
  variant / state gallery、anatomy overlay、responsive preview、minimal usage
  context；不为填满右栏生成无 source 支持的装饰性样本；~~
- 视觉模块按当前组件适用性选择，并放置在同一全宽页面的视觉区：default specimen、
  interactive preview、variant / state gallery、anatomy overlay、responsive
  preview、minimal usage context；不为填满版面生成无 source 支持的装饰性样本；
- **Source capture 是组件页的主视觉 anchor**（同 09C-D02 的契约）：组件规格
  来自设计中的具体元素，截图让设计师直接核对；origin 标记可见；
- 组件绑定的 states / motion 与组件自身的 variants / sizes 合并呈现，不再出现
  在 Interaction section；gallery 中的状态实例只呈现 source 声明的状态，不自动
  制造 gap 或伪样本；
- Preview controls 从当前 component spec 的 variants、sizes、states 和 props
  生成，不写死任何组件的控制器集合；
- Component Framework 是统一 presentation contract + renderer registry，不是假定
  能无条件绘制任何组件的万能 renderer；
- ~~来源不足时不得猜测组件外观：左栏显示具体缺失字段或 open gap，右栏显示明确
  unavailable state。~~
- 来源不足时不得猜测组件外观：规格区显示具体缺失字段或 open gap，视觉区显示
  明确 unavailable state。

**通用性验证**：Button 只作为交互控件类 fixture 之一；至少使用交互控件、内容
容器和页面 / 导航结构三类组件完成端到端 fixture（如 Button、Card、Page Shell /
Navigation），确保容器型、布局型组件不被强行套入 Button 的 variants / sizes
模型。

## Locked product decisions

- 组件的交互行为是组件规格，归组件页面呈现（09C-D01 决策的对应面）。
- visual origin 必须对设计师可见；Source capture 为最诚实档位，避免把 schematic
  误认为已实现的组件。
- ~~candidate 或 gap 参与样本时必须在相应视觉模块中可辨认，不能仅在左栏隐藏风险。~~
- candidate 或 gap 参与样本时必须在相应视觉模块中可辨认，不能仅在规格区隐藏风险。
- 空字段静默省略，但 omission 结果保持可审计。
- Button 不是产品范围边界，也不是唯一 acceptance fixture。
- 组件页为全宽单栏；不依赖 LeafSplit 或右栏空样本占位（2026-08-03）。

## Design prerequisite

组件页面的构图、preview controls、gallery、anatomy overlay、responsive viewport
与 origin 标记需要设计师提供或确认 Figma reference，至少覆盖 Button、Card、
Page Shell / Navigation 三类异构组件的共同框架——按**全宽单栏**重新确认模块
放置，不再假设左右分栏。取得 reference 后可把 Status 调整为 `ready-for-agent`。

## Acceptance criteria

- [ ] ~~所有 component spec 先进入统一 Component Reader，左栏使用约定字段组而不是
      原始 object dump~~
- [ ] 所有 component spec 先进入统一 Component Reader，规格区使用约定字段组而不是
      原始 object dump
- [ ] 组件绑定的 states / motion（来自 09C-D01 抽取拆分）在组件页面作为规格
      呈现，Interaction section 不再出现组件绑定条目
- [ ] Preview controls 从当前 component spec 生成，不硬编码任何组件的 variant、
      size 或 state 集合
- [ ] ~~Framework 支持六类右栏模块，并只显示当前组件适用的模块~~
- [ ] Framework 支持六类视觉模块，并只显示当前组件适用的模块（全宽页面内）
- [ ] Source capture / Code-backed / Source-generated / Schematic / unavailable
      五种结果在 UI 与 accessibility tree 中可以区分
- [ ] ~~code link 或数据不足时不伪造视觉实现；具体缺失原因和 open gap 在左栏可见~~
- [ ] code link 或数据不足时不伪造视觉实现；具体缺失原因和 open gap 在规格区可见
- [ ] 至少使用交互控件、内容容器和页面 / 导航结构三类组件完成端到端 fixture
- [ ] ~~Anatomy overlay 的编号与左栏 anatomy 条目可互相对应~~
- [ ] Anatomy overlay 的编号与规格区 anatomy 条目可互相对应
- [ ] candidate / formalized / gap 状态在涉及的视觉模块中保持可辨认，approval
      与 evidence 行为无回归
- [ ] renderer registry、component presentation、controls derivation 和
      unavailable fallback 有确定性测试
- [ ] 使用真实 Browser 对 Figma reference 完成三类组件的视觉、键盘及
      reduced-motion 核对

## Real Agent validation

- [ ] 真实 Agent 从包含至少三类异构 Component 证据的 Alignment input 生成并
      声明完整 source（含组件绑定 states / motion 归位）
- [ ] ~~Agent 在 Browser 中逐项核对左栏规格与右栏样本的 entry lineage，确认没有
      视觉模块引入 source 未支持的 variant、state、anatomy 或 responsive behavior~~
- [ ] Agent 在 Browser 中逐项核对规格区与视觉区的 entry lineage，确认没有视觉
      模块引入 source 未支持的 variant、state、anatomy 或 responsive behavior
- [ ] Agent 分别检查五种 origin outcome，并确认 Button 不是唯一可用的
      Component preview
- [ ] 真实 Agent / Browser 记录与 deterministic tests 分开保存

## Open gaps

- Figma reference 尚未提供；组件页需按全宽单栏重新确认构图与各视觉模块样式。
- Code-backed adapter 的安全装载边界和可支持的组件运行环境需在实现前结合现有
  Workbench runtime 做技术验证。
- 组件级 node provenance 依赖 09C-D02 建立的规则 → node 链接机制。

## Blocked by

- `09C-D01-interaction-section-text-only-strategy-rules.md`（组件绑定规格的抽取归位）
- `09C-D02-layout-source-capture-visual-anchor.md`（Source capture 契约与
  provenance 机制）
- 设计师确认的组件页 Figma reference

## Out of scope

- 不在本 issue 为所有未来组件编写专用 adapter。
- 不把组件实现代码复制到 Design System source。
- 不新增复杂 Design System 编辑器或任意 props playground。
- 不改变 component spec 的 evidence / status 资格。
- 不恢复 LeafSplit / 左右分栏布局。

## Comments

### 2026-08-01 — 方向决策（取代 09C-B 的 Component 部分）

原 09C-B「Visual Grammar 与通用 Component Preview Framework」按讨论结论拆为
三个独立 issue：Interaction 纯文本策略（09C-D01）、Layout source capture
（09C-D02）、本文件（Component 框架）。组件绑定交互规格随 09C-D01 的抽取拆分
归入组件页，是「Interaction 效果与组件强绑定」这一确认的直接推论。原 09C-B
文件已删除，其 Component 相关验收标准经修订后保留在本文件中。

### 2026-08-03 — 分栏退役后的前提修订

09C-A 退役 `LeafSplit` 后，本文件原左右栏假设作废。启用前须由设计师按全宽
单栏重新确认构图；实现不得再引入分栏 chrome 或空样本右栏。
