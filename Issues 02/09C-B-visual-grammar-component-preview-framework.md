# Visual Grammar 与通用 Component Preview Framework

Status: needs-info

## Parent

- `09C-A-design-system-reader-projection-resizable-split.md`

## What to build

在 09C-A 的 Reader Projection 和可拖拽双栏上，建立按设计信息语义选择表现方式的
Visual Sample grammar，并把它贯穿 Typography、Layout、Interaction 和多个不同类型
Component 的完整 Browser 路径。

本 issue 不建设一个只适合 Button 的专用详情页，也不把所有信息塞进同一种通用
卡片。Visual renderer 按信息性质分为：

- Typography：真实字体 specimen、字阶、weight、line-height 和 tracking 对比；
- Layout：container、grid、section rhythm 和 responsive relationship 的空间关系图；
- Interaction：default / hover / active / focus-visible / disabled / loading 等状态实例，
  以及 duration / easing 等时间信息；
- Component：由统一 Component Reader 和 Preview Framework 选择适用的实例、变体、
  状态、anatomy、responsive 和 usage-context 模块。

所有 Component 先投影为统一、可读的 component presentation：

- 左栏按 Purpose、Anatomy、Variants、Sizes、States、Properties、Token links、
  Usage rules、Content rules、Responsive behavior、Code links、Open gaps、Status 和
  Evidence 分组；
- 空字段不显示成噪声，但其 omission / not-applicable 结果仍可从 Technical details
  与 extraction lineage 审计；
- 右栏从以下视觉模块中选择适用项：
  1. Default specimen；
  2. Interactive preview；
  3. Variant / state gallery；
  4. Anatomy overlay；
  5. Responsive preview；
  6. Minimal usage context。

Component preview controls 从 spec 的 variants、sizes、states 和 props 生成，不能在
页面里为 Button 写死一套控制器。不同组件类型共用 preview shell、状态和可访问性
契约，通过 adapter / renderer registry 接入实际渲染能力。

Preview 必须声明自己的来源：

- **Code-backed**：有效 code link 与 preview adapter 渲染的真实组件；
- **Source-generated**：结构化 spec 足够时生成的 data-backed sample；
- **Schematic**：只能表达 anatomy、区域关系或响应式关系的示意预览。

来源不足时不得猜测组件外观。左栏显示具体缺失字段或 open gap，右栏显示明确的
unavailable state；不能用一个看似完整但没有证据的通用组件冒充当前设计。

Button 只作为交互控件类 fixture 之一。本 issue 还必须使用至少两个结构不同的组件
验证通用性，例如 Card 与 Page Shell / Navigation，确保容器型、布局型组件不被强行
套入 Button 的 variants / sizes 模型。

## Locked product decisions

- 09C-A 的可拖拽双栏和“文本在左、视觉在右”边界继续适用。
- Visual Sample 必须消费 DB-backed source entries；不得引入未经 evidence 支持的新
  Design System 决策。
- 视觉区域可以包含自身必要的 label、measurement、state 和 anatomy annotation，
  但不能承担独立说明文档。
- Component Framework 是统一 presentation contract + renderer registry，不是一个
  假定能无条件绘制任何组件的万能 renderer。
- Button 不是产品范围边界，也不是唯一 acceptance fixture。
- visual origin 必须对设计师可见，避免把 schematic 误认为已经实现的组件。
- candidate 或 gap 参与样本时必须在相应视觉模块中可辨认，不能仅在左栏隐藏风险。

## Design prerequisite

用户已确认通用 Visual Grammar 和 Component Preview Framework 的能力边界。Paper
中的 Layout、Interaction 与 Button Visual Samples 是信息组织参考，不是最终 UI
实现稿。实现前仍需设计师提供或确认相应 Figma reference，至少覆盖：

- Typography、Layout、Interaction 的右栏构图；
- preview controls、gallery、anatomy overlay 与 responsive viewport 的交互；
- Code-backed / Source-generated / Schematic 的来源标记；
- Button、Card、Page Shell / Navigation 等异构组件的共同框架。

取得 reference 后可把 Status 调整为 `ready-for-agent`。

## Acceptance criteria

- [ ] Typography renderer 完整呈现 source-backed family、semantic roles、size、
      weight、line height 和 tracking，不只显示 token table。
- [ ] Layout renderer 能把 container、grid、section rhythm 和适用的 responsive
      relationships 转成空间关系图，并和左栏规则逐项对应。
- [ ] Interaction renderer 能并列呈现适用状态及 motion tokens；不支持的状态不会被
      自动制造为 gap 或伪样本。
- [ ] 所有 component spec 先进入统一 Component Reader，左栏使用约定字段组而不是
      原始 object dump。
- [ ] Preview controls 从当前 component spec 生成，不硬编码 Button 的 variant、
      size 或 state 集合。
- [ ] Framework 支持 default specimen、interactive preview、gallery、anatomy、
      responsive 和 usage context 六种模块，并只显示当前组件适用的模块。
- [ ] 至少使用交互控件、内容容器和页面/导航结构三类组件完成端到端 fixture；Button
      只能占其中一类。
- [ ] Code-backed、Source-generated、Schematic 和 unavailable 四种结果在 UI 与
      accessibility tree 中可以区分。
- [ ] code link 或数据不足时不伪造视觉实现；具体缺失原因和 open gap 在左栏可见。
- [ ] Anatomy overlay 的编号与左栏 anatomy 条目可互相对应。
- [ ] Responsive preview 消费 spec 中声明的 responsive behavior，并在可拖拽右栏
      宽度变化时保持可用。
- [ ] candidate / formalized / gap 状态在涉及的视觉模块中保持可辨认，approval 与
      evidence 行为无回归。
- [ ] renderer registry、component presentation、controls derivation 和 unavailable
      fallback 有确定性测试。
- [ ] 使用真实 Browser 对 Figma reference 完成 Typography、Layout、Interaction 和
      三类 Component 的视觉、键盘及 reduced-motion 核对。

## Real Agent validation

- [ ] 真实 Agent 从包含 Typography、Layout、Interaction 和至少三类异构 Component
      证据的 Alignment input 生成并声明完整 source。
- [ ] Agent 在 Browser 中逐项核对左栏规则与右栏 sample 的 entry lineage，确认没有
      视觉模块引入 source 未支持的 variant、state、anatomy 或 responsive behavior。
- [ ] Agent 分别检查 Code-backed、Source-generated、Schematic 和 unavailable
      outcome，并确认 Button 不是唯一可用的 Component preview。
- [ ] 真实 Agent / Browser 记录与 renderer、controls derivation 和 fallback 的
      deterministic tests 分开保存。

## Open gaps

- Figma reference 尚未提供；各 renderer 构图、preview controls、origin marker 和
  anatomy overlay 的具体视觉仍待设计师确认。
- Code-backed adapter 的安全装载边界和可支持的组件运行环境需在实现前结合现有
  Workbench runtime 做技术验证。

## Blocked by

- `09C-A-design-system-reader-projection-resizable-split.md`
- 设计师确认的 Design System Browser Figma reference

## Out of scope

- 不在本 issue 为所有未来组件编写专用 adapter。
- 不把组件实现代码复制到 Design System source。
- 不为了填满右栏而生成没有 source 或 code 支持的装饰性样本。
- 不新增复杂 Design System 编辑器或任意 props playground。
- 不改变 component spec 的 evidence / status 资格。

## Comments

### 2026-07-31 — Layout 碎片信息的页面化可视化

设计师确认：Layout source 只提供碎片化信息时，Browser 不得据此伪造一个完整页面；
但“不能伪造完整页面”不等于“不能使用页面形式呈现”。页面、section、component 或
viewport 外框可以作为规则的中性坐标系，让单条空间事实获得足够上下文并被直观看懂。

**最小充分场景**

- 每条 Layout 规则应生成一个只包含理解该规则所需上下文的最小场景。
- 例如仅有左右 page inset 时，仍可绘制一个页面实例：页面外框与中性 content field
  提供坐标，左右两侧用高亮区域和标尺呈现已声明的 inset。
- 场景中的页面外框是 presentation scaffold，不代表 source 已声明完整 Page Shell；
  不得补入未经证据支持的 Header、Hero、Footer、内容模块或视觉样式。
- page-level 事实使用页面场景，section-level 事实使用 section 场景，component-level
  事实使用 component 场景；场景尺度由规则的 semantic scope 决定。

**已知、上下文与未知的视觉边界**

- 当前选中的 source-backed 空间事实使用明确的高亮、测量线和数值 / token 标注。
- 为理解事实而存在的外框或占位区域使用中性样式，并与 source-backed 内容在视觉和
  accessibility tree 中可区分。
- 空白表示未声明 / 未知，不表示设计已经确认该区域为空。
- 每个此类实例必须显示 `Schematic` origin，避免被理解为真实页面还原。
- 已知 viewport 与 content 尺寸时可以按比例绘制；缺少构成比例所需的尺寸时使用规范化
  外框并标明 `Not to scale`，不得让示意比例冒充 source measurement。
- candidate / formalized / gap 继续表达 source 状态；高亮仅表达当前选中事实，不能与
  status 颜色含义混用。

**Isolate / Compose**

- `Isolate`：一次只把一条规则应用到最小充分场景，作为默认的精确阅读方式。
- `Compose`：允许把相同 semantic scope、引用兼容实体且互不冲突的已知规则叠加到
  同一个场景中。
- Compose 必须列出当前应用的 source rules，并允许逐条开关；组合结果仍是规则演示，
  不宣称是完整页面或真实设计稿。
- 不同 scope、无法建立共同坐标系或存在冲突的规则保持为独立场景，不强行合并。
- renderer 不可用属于 presentation fallback，不自动产生新的 Design System gap。

**适用示例**

- Page inset → 页面两侧高亮边带。
- Max width → viewport 内居中的 content field 与宽度标尺。
- Section gap → 两个中性 section 之间的垂直测量区。
- Grid gap / columns → 重复轨道、栏数和间距标记。
- Sticky header → 简化滚动页面中锚定顶部的区域。
- Horizontal overflow → 被裁切的横向轨道与可发现的后续内容。
- Responsive stack → 同一最小场景在已声明 breakpoint 两侧的结构变化，同时区分
  change 与 invariant。

该决定补充 Layout Visual Grammar 的信息组织边界；具体构图、控件样式和动效仍需在
正式 Figma reference 中确认，issue 状态保持 `needs-info`。

### 2026-07-31 — Blueprint + Checklist 实现完成，待确认事项

已实现并全量验证（vitest 857 全绿、typecheck 干净、Playwright e2e、Chrome 实机逐项
验证）：Layout Blueprint 组合图、规则行与图形的 anchor 对应、hover Isolate、整行点击
勾选 Compose（无 chips / Clear 控件）。

待设计师确认：

1. 本次构图、控件样式和动效均属自设计（对话中逐项拍板），仍待正式 Figma reference
   确认。
2. 默认态是“全规则组合图”，hover 单条规则才 Isolate——与本文件验收标准中
   “Isolate 为默认阅读方式”不同，是按 Checklist 原型语义集成时的判断。
3. `page insets` 目前只作行内字段展示，未画成页面两侧高亮边带（projection 尚无
   inset 事实类型）。
4. 选中态与 candidate status 共用 `--dsc-accent` 蓝色；若严格执行“高亮不复用
   status 颜色”，需另行定夺。
