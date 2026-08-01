# Layout Atlas 视图与 meaning-first 默认态

Status: ready-for-agent

## Parent

- `09C-A-design-system-reader-projection-resizable-split.md`
- `09C-B-visual-grammar-component-preview-framework.md`

## What to build

Layout 叶子页弃用左右 split panel，改为 Atlas 卡片流，沿用 Typography Atlas
（`dsb-atlas-*`）已经建立的交互模式。

动机：作为 Agent 插件，Browser 的可用宽度常常很窄，左右双栏（左 42% /
右 58%）在这种宽度下两栏都被压缩得难以阅读；同时当前主阅读层把
`relationship` / `responsiveBehavior` / `acceptanceChecks` 等 rich 字段的每一句
散文原样铺开，默认视图信息过载。

改为卡片流后：

- 每条 layout rule 一张卡片；
- 卡片默认状态只显示：`meaning`（一句话语义）、该规则自己的空间示意图、
  关键结构化数值（gap / columns / maxWidth 等）、status chip 与审批操作；
- 每张卡片拥有属于自己这条规则的可视化（单规则粒度的 schematic，复用
  09C-B 的 Layout Blueprint 投影）；**不追求**把所有规则集体绘制为一张
  可视化页面；
- `relationship` / `responsiveBehavior` / `tokenLinks` / `acceptanceChecks`
  默认折叠，在卡片内展开查看；原始 JSON 仍归 Technical details；
- 窄宽度（Agent 插件场景）下卡片单列排布，文字与示意图都保持可读，
  不出现横向挤压。

本 ticket 只改 Layout 一个 section（tracer bullet）；其余 section 的 split
panel 去留待本模式验证后另开 ticket。candidate → formalized 审批、
evidence popover、status 汇总等既有能力在原路径上保持可用。

**生成式 UI 规则（设计师锁定）**：示意图渲染器是一套稳定的生成语法，
服务于之后每一次抽取，而不是仅为当前数据服务——识别词汇封闭（09C-B
空间事实类别）、组合优先级固定、标注使用源值原文、不可绘制时诚实降级；
禁止任何按规则 / 按项目特判的绘制代码。未来 Interaction、Component 等
section 应扩展这套语法，而不是另起新的绘制风格。

Projection 仍为确定性、可测试的 derived presentation model：不在运行时调用
模型改写文案，不成为第二套 Design System 真相源。

## Acceptance criteria

- [ ] Layout 叶子页不再渲染可拖拽双栏，改为规则卡片流；每条 rule 一张卡片
- [ ] 卡片默认态仅展示 meaning、单规则示意图、关键结构化数值与 status /
      审批操作；responsiveBehavior / acceptanceChecks / tokenLinks 默认折叠、
      可展开（relationship 作为安静的约束句留在默认层——原型评审中设计师
      确认的 Quiet 变体形态）
- [ ] 每张卡片的示意图只表达该规则自身的空间关系（单规则粒度），不存在
      集体可视化页面
- [ ] 约 400–600px 宽度下卡片单列排布，无横向滚动或文字挤压
- [ ] candidate → formalized 审批、evidence popover、Technical details
      （raw JSON）在原交互路径上保持可用
- [ ] 新的 projection 有对应 unit tests，可确定性重建并可追溯到原始 entry
- [ ] 示意图为通用生成语法（封闭词汇 + 固定组合优先级），代码中无任何
      按规则 / 按项目特判的绘制分支

## Blocked by

- 09C-B02（按约定顺序最后实施：先有风格契约与重写后的数据，再改前端 UI）

## Comments

- 2026-08-01：原型评审（两轮发散）锁定：OQ 为屏幕居中大面板（Quiet 的
  列表式交互 + Interview 的留白密度）；relationship 以安静约束句形式留在
  卡片默认层，其余 rich 字段折叠进 Rule details（验收标准已相应修正）。
  生成式 UI 规则由设计师在同日明确：示意图必须是服务未来每次抽取的通用
  生成语法，禁止按规则/项目特判。

- 2026-08-01：起源于 ikran test 7 的 Layout 页走查。设计师原始 annotation
  是简短中文，经 09B 抽取扩写为多句英文散文后，主阅读层原样全量渲染，
  默认视图过于繁琐；同时 split panel 在插件窄宽度下拥挤。写作风格问题
  本身由 09C-B01 在抽取契约层收敛，本 ticket 只解决展示分层与布局形态。
