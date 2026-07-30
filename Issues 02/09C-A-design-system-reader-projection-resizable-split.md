# Design System Reader Projection 与可拖拽双栏

Status: ready-for-human

## Parent

- `09A-design-system-browser-v1-form-and-source.md`
- `09B-initial-design-system-extraction-completeness.md`

## What to build

把 09B 已经完整抽取、经 DB 实时 join 后交给 Browser 的结构化 Design System
信息，转换为面向设计师阅读的确定性 Reader Projection，并用 Typography 作为第一条
端到端 tracer bullet。

当前 Browser 把不同语义的 entry 统一压成 name / value / meaning / status 行，复杂
value 直接序列化为结构化文字。09C-A 不修改 Design System source、DB 真源或证据链，
而是在 Browser 内新增 derived presentation model：

- 将内部 entry id、alias 和结构化 value 归纳为设计师可理解的标题、字段组和短段落；
- 按 entry 类型保留 rationale、scope、use、avoid、exceptions、responsive
  relationships、token links、checks 等已经抽取的信息；
- 主阅读层不显示原始 JSON，内部 id、alias graph 和原始字段进入 Technical details；
- status、candidate approval 和实时 evidence popover 保持可见、可操作；
- projection 必须可确定性重建、可测试且可追溯到原始 entry，不在运行时调用模型改写
  文案，也不成为第二套 Design System 真相源。

Browser leaf 使用统一的左右双栏：

- 左栏承载页面标题、状态汇总、所有规则、说明、usage / avoid、Technical details 和
  Evidence 入口；
- 右栏只承载 Visual Samples，以及属于样本自身的测量值、状态名、解剖标签等视觉标注；
- 不增加“一句话结论”或重复解释页面名称的 summary；
- 默认比例为左 42% / 右 58%；
- 中间分隔线可拖拽，用户可自由调整比例；
- 用户调整后的比例在 leaf 切换和 Browser 重新打开后保持一致，并作为本地用户偏好
  持久化；
- 双击分隔线恢复默认比例；
- 分隔线支持键盘调整、明确的 hover / focus 状态和足够的 pointer hit area；
- 两栏分别有最小可用宽度，不能把文字或样本压缩到不可读；
- 窄屏无法维持最小宽度时自动变为“左栏规则在上、右栏样本在下”的单列顺序。

Typography 是本 slice 的完整验证页面。左栏把 family、semantic roles、size、weight、
line height、letter spacing、transform 和 token relationships 组织成可读信息；右栏
至少渲染 source-backed 的真实字体 specimen 和基础字阶，让当前项目确认的
Instrument Sans 等事实不再只以 token row 出现。

这是一条完整的 Browser 纵向切片：DB-backed API 输入、Reader Projection、可调整页面
结构、Typography visual sample、状态与 evidence、自动测试和真实 Browser 验证必须
同时交付。

## Locked product decisions

- Design System source 仍全部为 JSON；Browser 仍只读取 DB-backed API。
- `design-system-view.json` 仍是 Runtime-owned derived export，不成为 Browser 输入。
- Reader Projection 是纯衍生视图；不得回写、覆盖或复制 canonical source facts。
- 页面不使用“一句话结论”；页面名称已经承担主题识别。
- 所有规则和说明性文本只出现在左栏；右栏不出现独立说明段落。
- 右栏视觉标注可以显示必要的 token 值、尺寸、状态名和 anatomy label。
- 42% / 58% 是默认值，不是固定值。
- 调整比例是 Browser 级用户偏好，不按 leaf 保存，避免切页时布局跳动。
- candidate / formalized / gap 的语义、审批写回和 evidence lineage 不改变。

### 2026-07-30 Typography visual-first follow-up（覆盖上文相关版式）

**Type Atlas** 是 Typography 的正式视觉呈现。以下决定覆盖本 issue 上文中仅针对
Typography 的左右栏描述；
Layout / Interaction 等尚无正式视觉 grammar 的 leaf 仍保留统一可拖拽 split：

- Typography 不再把 token rows 与 visual samples 分置左右栏，而改为全宽 Atlas；
- 页面顶部必须继续使用 Browser 其他 section 的标准 `PageHeading`，不使用原型中的
  独立 kicker / marketing title / intro；
- 每一种实际出现的字体形式直接附带 usage、family、size、weight、line height、
  tracking、transform 与 source / evidence；缺失字段不推测、不补全；
- 只有 atomic size 而没有完整 style 的历史数据，形成诚实的 scale specimen：沿用唯一
  已声明 family，但不虚构 weight / line height / tracking；
- 原始 source rows 降级为折叠的二级核对层，Technical details 继续保留完整 raw
  envelope，因此视觉优先不改变 DB 真源、审批或证据链；
- Atlas 状态标记使用 4px 圆角、无 border / stroke / inset ring；此改动不扩散到
  Browser 其他既有 status chip；
- 正式方案晋升后删除临时 `/prototypes/typography-reader` 路由。

## Design prerequisite

用户已确认本 issue 的信息架构和交互边界。以下 Paper 页面只用于记录讨论中确认的
Visual Sample 组织方式，不是最终实现稿：

- `https://app.paper.design/file/01KY59X1RDAQ2M73AG7BCABY06/1-0/VR-0`
- `https://app.paper.design/file/01KY59X1RDAQ2M73AG7BCABY06/1-0/15G-0`
- `https://app.paper.design/file/01KY59X1RDAQ2M73AG7BCABY06/1-0/1OW-0`

2026-07-30 设计师（issue 作者）口头确认：Paper 仅作 IA 参考，授权在本 slice 内
自主完成完整视觉实现（见文末「设计决策 2026-07-30」）。

## Acceptance criteria

- [x] DB view 中的结构化 principle、typography style 和其他 object value 经过确定性
      Reader Projection 后形成可读字段组，不在主阅读层出现原始 JSON。
- [x] Projection 对每个展示字段保留 source entry identity，完整信息仍可在
      Technical details / Evidence 中访问。
- [x] Typography 使用全宽 Type Atlas；每个 source-backed specimen 就地呈现 family、
      semantic role / usage、size、weight、line height、letter spacing、transform
      和适用的 token relationships。
- [x] 页面顶部继续使用统一 Browser section 标题；没有额外 kicker、marketing title
      或“一句话结论”。
- [x] Atomic size 历史在缺少完整 style 时只展示有证据的字段，不虚构 weight、
      line height 或 tracking。
- [x] Atlas 状态标记为 4px 圆角且无描边；其他 Browser status chip 不受影响。
- [x] Instrument Sans 以项目内 self-hosted FontFace（400 / 500 / 600 / 700）实际加载，
      不再出现 CSS family 名正确但 glyph 静默 fallback 的情况。
- [x] 双栏默认比例为 42% / 58%，可通过 pointer 拖拽连续调整。
- [x] 用户调整后的比例跨 leaf、跨关闭重开保持一致；双击可恢复默认比例。
- [x] 分隔线可以用键盘调整，具备可访问名称、focus indicator 和足够的操作区域。
- [x] 两栏最小宽度受保护；窄屏自动切换为规则在上、样本在下的单列结构。
- [x] Type Atlas 在双列、单列与窄屏下 reflow，不出现裁切、横向溢出或不可读文本。
- [x] formalized / candidate / gap、evidence popover 和 candidate approval 行为无回归。
- [x] 自动测试覆盖 projection 信息无损、复杂 object 不泄露 JSON、比例 persistence、
      reset、keyboard resize 和 responsive fallback。
- [x] 使用 09B rich fixture 验证确认字体、字阶、字重、行高和字距均能在可读层或
      Technical details 中找到，不因投影静默丢失。
- [ ] 使用真实 Browser 对 Figma reference 完成视觉与交互核对，和 deterministic
      component tests 分开记录。（Figma reference 不存在；已由设计师授权自主设计，
      改为请设计师对实现结果做视觉核对——见文末决策记录。）

## Real Agent validation

- [ ] 真实 Agent 使用 09B 的完整 preparation contract，从包含已确认字体、字阶、
      字重、行高和字距的 Alignment input 生成 Draft Design System。
- [ ] Agent 打开 DB-backed Browser，确认 Typography 左栏可读投影与右栏 specimen
      使用同一组 source facts，Technical details / Evidence 能反查原始 entry。
- [ ] Agent 拖拽、键盘调整、双击 reset 并关闭重开 Browser，确认比例保持与
      responsive fallback 符合 Figma reference。
- [ ] 真实 Agent / Browser 记录和 automated projection / interaction tests 分开保存。

（e2e `tests/design-system-reader-split.spec.ts` 已走通等价链路：alignment →
09B-rich sources 经 MCP ingest → Reader Projection 渲染 → 拖拽 / 键盘 / 双击 /
关闭重开持久化 → 窄屏 stacked。真实 Agent 验证留待人工执行。）

## Open gaps

- ~~本地比例偏好的精确 storage lifetime 和跨项目共享范围需在实现前锁定~~
  → 已锁定：server project-local route，`.ikran/design-system-browser.json`，
  LWW 无 revision，不跨项目共享（见决策记录）。
- 自主设计的视觉结果（sheet chrome、divider 样式、stacked 布局）待设计师核对。

## Blocked by

- ~~`09B-initial-design-system-extraction-completeness.md`~~（已完成）
- ~~设计师确认的 Design System Browser Figma reference~~（2026-07-30 设计师授权
  以 Paper IA + 自主设计替代，见决策记录）

## Out of scope

- 不在本 issue 覆盖 Layout、Interaction 或完整 Component preview grammar。
- 不新增 Design System source file 或 presentation source artifact。
- 不让模型在 Browser 打开时生成或重写展示文案。
- 不在右栏放置独立规则段落或重复的文档内容。
- 不改变 09A 的 source、ingest、approval、LWW event log 或 evidence 语义。

## 设计决策 2026-07-30

实现完成。以下决策由设计师（issue 作者）在实现过程中确认，或由 code review
双轴审查（Standards + Spec）定论，在此留档。

**设计师确认的决策**

- Paper 文件仅作 IA 参考；设计师明确**不要** Paper 中的 “recent updates”、
  “Evidence status” 汇总和底部横栏三个元素，并授权在本 slice 内自主完成完整
  视觉实现（替代缺失的 Figma reference）。
- 比例偏好持久化 = server project-local route：`.ikran/design-system-browser.json`
  （LWW、无 revision、不跨项目共享）。与 workbench layout 的持久化模式一致。
- role 行窄宽取舍：value 列不再固定 120px，随内容增长（tracking / transform 段
  不截断）；空间不足时整行 wrap 到下一行，而不是压缩省略。
- sheet chrome 调整（授权范围内，**请设计师核对**）：scrim 改为浅色调、sheet
  高度 94vh、leaf 页加小标题、Home navrow 替代 Back 按钮。
- sidebar 增加响应式 bar：760px 以下 tabs 固定 190px 可滚动——这是 stacked
  单列在窄屏真正可用的前提。

**实现与 review 定论**

- divider hit area 20px（可见线仍 1px + 中央 grab pill），`role="separator"` +
  `aria-label` / `aria-valuenow|min|max|valuetext` / `aria-keyshortcuts`；
  Arrow ±2%、Shift ±10%、Home / 双击复位 42%。
- 键盘隔离重构：旧 window capture 监听会吞掉 sheet 内键盘事件，是 divider 键盘
  调整的前提性修复；Esc 分层由 `sheetEscapeAction` 单一决策，Radix
  `react-dismissable-layer` 在 document capture 阶段抢先 dismiss 的问题用
  `onEscapeKeyDown` preventDefault 挡掉（popover 内 Esc 只关 popover）。
- 左栏 role summary 现携带 `tracking X` / transform 段（`formatTextStyleSummary`），
  右栏 specimen annotation 复用同一 summary，不再重复打印。
- principle 未知结构键不再 JSON.stringify 泄漏到主阅读层：rich shape 之外的键
  进入 `extraFields`（label + 格式化文本）；无任何已知键的对象整体走字段行投影。
- 不用 shadcn resizable：`react-resizable-panels` 并非项目依赖，且无法表达
  像素最小宽 + stacked 单列回退 + calc grid 无 JS 逐帧计算 + separator aria
  契约（理由同时记录在 `ds-split-pane.tsx` 头注释，对应仓库 “shadcn 优先” 规则）。
- 共享抽取：`atomicWriteJson` 提到 `lib/runtime/atomic-write-json.ts`
  （workbench-layout 与 browser preferences 共用）；默认比例常量单一来源在
  `design-system-browser-preferences-shared.ts`。
- code review 双轴已执行：Standards 轴修掉重复常量 / 命名冲突（tsx 内局部
  `LeafSplitProps` → `LeafSplitRatioProps`）/ 死代码（`leftPanePx`、
  `.dsb-samples-empty-body`）；Spec 轴修掉 tracking/transform 缺失、未知键 JSON
  泄漏、divider hit area 不足、右栏说明段残留（违反 locked decision）。
  辩护后保留：b3（projection 放 components/ 而非 lib/——它依赖 view-model 的
  展示语义，纯展示无运行时状态）、b4（preference 读写防抖 300ms 与 workbench
  layout 一致）、b5（SSR stacked 首渲是有意的 no-flash 取舍）。判断题跳过：
  specimen 格式化 helper 留在 tsx（与 09A 既有结构一致，不为本 issue 扩散重构）。

**验证记录**

- `npx vitest run`：91 文件 832 测试全绿（含 Atlas、multi-hop alias、
  unresolved-family、self-hosted font、projection / preferences / split-pane
  model 单测与 JSON 无损断言）。
- `npm run check`（typecheck + e2e）：80 passed，含新 spec
  `tests/design-system-reader-split.spec.ts`（真实 Workbench 链路：拖拽 / 键盘 /
  双击 / 关闭重开持久化 / 500px stacked 无横向溢出；Typography Type Atlas、
  4px 无描边 status 与 Instrument Sans 实际 FontFace load）与 09A 既有 spec 无回归。
- 真实 Browser 复核：当前项目 7 个 source-backed 字号 form 均进入 Atlas；标准
  Typography section title 保持不变，双列卡片 `scrollWidth === clientWidth`，状态
  计算样式为 `border-radius: 4px; border-style: none; box-shadow: none`。
