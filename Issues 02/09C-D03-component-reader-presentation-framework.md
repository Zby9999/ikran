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

### 2026-08-03 — Components Home 画廊与 tile 形态决策（设计师确认）

设计师在讨论中确认以下决策，作为组件页构图的第一批结论：

1. **两阶段同一信息架构，视觉档位逐 tile 切换**。初步抽取阶段（无真实代码）
   与首次 Prototype 完成之后，Components Home 结构不变；变化的是每个 tile
   的视觉 origin（capture → code-backed），不引入两套页面形态。
2. **第一阶段 Home = 画廊**（非纯文字清单）：tile = source capture + 名称 +
   状态 chip。设计师在画廊中视觉确认抽取范围（「是不是我要的那个组件」）；
   确认动作沿用 candidate → formalized 审批语义，两阶段不变。
3. **页面结构类组件（Page Shell / Navigation 等）的 tile = 缩放真实上下文**：
   第一阶段为原设计 source capture，第二阶段为真实 prototype 页面的缩略
   渲染（页面比例缩略图）。tile 承担「认脸」，不承担讲规格；结构区划图
   （zone 划分）收在详情页，以 anatomy overlay 形式叠加于 source capture，
   编号对应规格区 anatomy 条目。理由：tile 尺度下骨架 zone 不可读，认脸
   优先；区划图是生成的抽象，需 anatomy 数据成熟后上线，不阻塞 tile。
4. **tile 可交互是 code-backed 专属的档位能力**：
   - 有真实代码的控件 / 容器 tile 为活渲染，可交互（hover 出 state 等），
     对齐 shadcn 首页形态；
   - capture tile 为静态截图，交互仅有点击进详情——静态不作为「坏掉的
     活 tile」呈现，交互能力差异本身是 origin 档位的可感知信号；
   - 页面结构类 tile 为活渲染但指针不穿透，整块点击进详情；
   - 深交互（从 spec 生成的 preview controls）归详情页 interactive preview
     模块，tile 不承载控制器；
   - 可交互 tile 需键盘等价操作与 reduced-motion 行为；code-backed adapter
     安全装载边界完成技术验证前，静态渲染是任何时刻都成立的兜底。

masonry 网格节奏：控件小方块、容器中幅、页面结构为页面比例宽幅 tile，tile
尺寸本身传达组件尺度层级。

待后续讨论：详情页全宽单栏的规格区 / 视觉区编排、五档 origin 的可辨视觉、
组件绑定 states / motion 与 variants / sizes 的合并呈现、candidate / gap
在视觉模块中的可辨认性。

### 2026-08-03 — 详情页 hero 布局与两档 Origin 决策（设计师确认）

**Origin 收缩为两档（取代五档）**。设计师判定 Source capture / Code-backed /
Source-generated / Schematic / unavailable 五档链过于复杂，收缩为：

- **Code-backed**：真实代码活渲染；
- **Source capture**：原设计截图；
- 其他一切情况回退为**显式无可视化**（不保留 Source-generated 与
  Schematic 两个合成档）。理由：被删除的两档是唯一需要「防误认」标记的
  合成像素；保留的两档都是证据型视觉（设计的照片 / 实现的照片），不存在
  误认风险。需要可视化而信息充分的组件，用户可要求 Agent 真正实现为
  code-backed，不需要系统合成近似外观。

推论：

- **显式无可视化状态**：必须说清缺什么（如无 code link、无 source
  capture），并可指引「可要求 Agent 实现该组件以获取实时预览」；空白是
  事故，unavailable 是结论。
- **zone 区划图不算 Schematic，算带标注的 capture**：详情页 anatomy
  overlay 是叠加在 source capture 上的编号标记（底子是照片、标记是证据
  索引），不合成外观，在新规则下保留。独立线框示意图才消失。
- **视觉可辨设计负担消失**：只需区分活 / 静，交互能力差异本身即是信号；
  无障碍树相应简化。
- **验收标准与 09C-C 范围影响**：本文件验收中「五种 origin outcome 可
  区分」「renderer registry」相关条目启用时按两档重写；09C-C 不再需要
  Source-generated / Schematic renderer，coverage audit 简化为 capture /
  code-backed / 明确不可得三结果。

**组件详情页布局（全宽单栏）**：

- 顶部为 hero 视觉区（code-backed 活组件或 source capture），标题与详细
  信息在 hero 之下——**打破 09C-A「所有 leaf 顶部先出标准 PageHeading」
  的次序，确认为组件详情页特例**，其他 leaf 不变；
- states 名称直接显示在 hero 视觉底部，hover 不同 state 即可观察变化；
- states hover 按 origin 只有两种情况：code-backed → hover 切真实状态；
  capture → 每个 state 各有一张截图则 hover 换图，只有一张则 states 名称
  只读展示。无中间档。

### 2026-08-03 — Home 画廊细化决策（设计师确认）

承接上一条，Home 页剩余五个问题全部确认：

1. **Tile 尺寸分级 = 混合判定 + 设计师可覆盖**。判定顺序：spec 声明的
   scale/kind → capture 宽高比启发式（接近页面比例的宽幅 → 结构档）→
   中幅兜底。设计师可在 tile 上就地纠偏：hover / focus 时角落出现轻量控件，
   在「小 / 中 / 宽」三档间循环切换，画廊即时 reflow。覆盖是 **Browser 本地
   呈现偏好**，不写回 component spec、不改分类 / 状态 / 证据链（v1 写操作
   仍只有状态审批）；若档位错源于底层分类抽错，覆盖只是贴住症状，根因靠
   改进抽取，不得把该控件当分类修正工具。实现注意：原 Browser 偏好持久化
   路径已随分栏退役删除，per-component 覆盖需新的本地偏好持久化位置。
2. **Capture 一律 fit**：完整显示 + 中性底色，不裁切（认脸优先于网格齐整）。
3. **排序与空缺**：默认 candidate 在前、同级按名称；v1 不加筛选器、不做
   类别聚簇（类别数据不可靠时聚簇会放大错误）。gap 组件照常进网格，tile
   为明确空缺态：中性底 + 名称 + "No capture" + gap chip，不隐藏、不假装
   有内容。
4. **Tile 级不加 origin 文字徽章**：交互行为即档位信号（活 = code-backed，
   静 = capture）；显式标记按需留给未来最易误读的 Schematic 档。详情页保留
   完整 origin 信息。
5. **键盘模型**：tile 对键盘为单一停靠点（整块 = 进详情链接）；state 探索
   的键盘等价物是详情页 preview controls。此条细化（而非推翻）上一条决策
   中「可交互 tile 需键盘等价」的原则。

至此 Components Home 形态收敛。下一步：组件详情页（上一条「待后续讨论」
清单）。

### 2026-08-03 — 取消 Components 总览，侧边栏直达详情；详情页选定 Placard（设计师确认）

设计师重新评估后判定：Blocks（页面结构）与 Components 作为组件的表现形式
天然不同，强行设总览页只会制造冗杂——同放一页过长，加视图切换则形成
「Foundations / Components」与「Components / Blocks」两层切换，交互繁琐。
因此 **supersede 上两条 Home 画廊决策**（「Components Home 画廊与 tile 形态
决策」第 2、3 条及「Home 画廊细化决策」全部五条）：

1. **取消一切 overview**：不设 Components Home / 画廊；组件经左侧侧边栏
   直接查看，点击即进详情页。Blocks 与 Components 表现形式不同的问题随之
   消解——各自只有详情页，无需共处一个网格；交互层级只剩 Section Tabs
   一层。
2. **Foundations Home 保留**：它承载 principles 与 visual language 叙述，
   是内容页而非目录，不受本决策影响。
3. **侧边栏承接原 Home 的职责**：分组（Blocks / Components），组头带状态
   汇总（n formalized · m candidate），条目带状态点；点击 Components tab
   落在当前 / 第一个组件，侧边栏选中态即详情页。
4. **Blocks 认脸形态不变**：页面结构类组件详情页 hero = 缩放真实上下文
   （capture → 活页面缩略渲染）；zone 区划图仍以带标注 capture 的形式
   收在详情页 anatomy overlay。
5. **不损失的部分**：tile 可交互的精华（states hover 观察状态变化）已由
   详情页 hero 的 states 条承接；两档 origin、显式不可得态维持前条决策。
6. Home 画廊实现线程已停止；masonry 分级、tile 尺寸覆盖控件、tile 键盘
   模型、画廊排序 / 空缺态等细化项随总览一并取消。

**详情页方向选定 Placard**：经 prototype 三变体对比
（`app/prototypes/component-detail/`：Placard 展台卡 + 居中阅读栏 /
Ledger 通栏密排行 / Inspector 工具 chrome + 分组卡片），设计师选定
**Placard**：

- hero 为展台卡（白卡、hairline 边框、组件居中、origin 标记在右上）；
- states 名称文字行位于 hero 底部居中，hover / focus 切换组件状态；
- hero 之下为居中阅读栏：标题 + 状态 chip、Purpose、Props（candidate 条目
  带 chip）、Boundaries、Token links、evidence 行；
- 此前决策不变：states hover 按 origin 只有 code-backed 切真状态 /
  capture 换图（或只读）两种情况；hero 先于标题为组件详情页特例。

prototype 表面在实现晋升后按惯例删除。

### 2026-08-03 — Slice 1 实现记录（commit `c2090ff`）

已落地（真实 Browser，非 prototype）：

- Components Home 删除；tab 直达列表第一个组件（`landingLeaf` 单一真源，
  section 直落时侧栏同步选中态）；侧栏分组 Components 先、Blocks 后，组头
  按**组件**计状态汇总（worst-of），条目状态点 + candidate 蓝点 #2473cc。
- `ComponentDetail` 按 Placard 重写：hero 展台卡（capture / 显式不可得两档，
  origin 标记右上、stale caption 左下）、只读 states 名称行；620px 居中
  阅读栏（Purpose / Props / Boundaries / State matrix / 数据驱动可选分组 /
  Status & evidence）；空字段静默省略。
- spec value 新增可选 `group` 闭枚举（schema 校验，旧 spec 向后兼容）；
  view 层 `layoutCaptures` 泛化为 `captures` 并装饰到 component spec。
- `DsVisualOrigin` 收缩为 code-backed / source-capture / unavailable。
- 双轴 code-review（Standards + Spec）已执行，6 项修复随本 commit 落地
  （组头按组件计数、landing 真源统一、直落选中态、stale 标记、origin
  收缩、头部注释同步）。
- 验证：tsc 干净；vitest 93 文件 922 测试全绿；playwright
  design-system-browser / design-system-reader 两个 spec 通过。附带修复了
  4cefd78 遗留的 `ds-row-visual-language` 陈旧 e2e 断言。

本 slice 未做（后续 slice）：code-backed hero 活渲染、states hover 真切换 /
多 capture 换图、preview controls、anatomy overlay。prototype 表面
`app/prototypes/component-detail/` 按设计师指示暂时保留；CSS `.dsb-card`
死代码待清理。真实 Agent 验证（三类异构组件 fixture、capture 覆盖）待
09B 重新抽取产出带 `sourceCaptures` 与 `group` 声明的真实 spec 后进行。

### 2026-08-04 — 组件级真实声明与 Browser 核对（ikran test 7）

范围：不做完整 09B 重抽取（需新 `prepare_initial_design_system` 命令），
仅对既有 3 个组件 spec 补 `group` + `sourceCaptures`，走真实
`record_artifact_written` 声明 → ingest 通道验证 D03 实现。

- 抽取契约扩展（本仓库）：`INITIAL_DESIGN_SYSTEM_SOURCE_CONTRACT` 的
  `component_spec_fields` 追加 `group` / `sourceCaptures`；新增
  `component_group_field`（component 默认，页面结构复合体声明 block）与
  `component_capture_field` 指引——复用 D02 裁切契约，只承认
  source-capture / code-backed 两种诚实来源，两者皆无则省略字段、浏览器
  诚实的 unavailable，日后再要求 Agent 产 code-backed。契约只是写作
  指引，不影响 schema 校验与 `component_spec_fields_missing` 门禁
  （后者仍按 `RICH_COMPONENT_SPEC_FIELDS`）。
- capture 制作：Text Link 从 `horizontal-project-gallery-redo.png` 裁
  480×320（3:2）含 "See Project →" 实例区块
  （`design-system/captures/text-link-see-project.png`，nodeRect 标记
  链接位置，nodeId 未知故省略）；Project Strip 直接复用 redo.png
  （node 1:157）；Sticky Navigation 复用 sticky-top-bar.png 整页定位图
  （node 1:229，附带 surfaceId 利于 stale 判定）。裁切图已读回目检。
- spec 更新（ikran test 7，不入本仓库 git）：`value.group` =
  component / component / block；`sourceCaptures` 顶层数组复用 D02
  layout 声明的精确 provenance。三个声明全部 `ingested`、零
  quality_diagnostics，DB 落库确认。
- 真实 Browser 核对（webbridge，dev server localhost:56970）：侧栏
  Components 组（Text Link 绿点 / Project Strip 蓝点）先于 Blocks 组
  （Sticky Navigation 蓝点），landing 直达 Text Link；三个 Placard hero
  均显示 capture（Source capture 标记 + 左下 caption），states 只读
  名称行、阅读栏分组（Purpose / Props / …）与 group 标签
  （Component / Block）全部正确。截图存档 `.scratch/dsb-verify/`。

遗留：Sticky Navigation hero 用整页定位图，顶栏占比小（D02 locator
风格，位置标记因 width=1 视为近满而不渲染）；待有真实代码后应换
code-backed hero。声明脚本 `.scratch/declare-component-specs.ts`
（一次性，tsx 直调 `recordArtifactWrittenCommand`）。
