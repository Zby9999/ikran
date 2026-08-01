# Visual Coverage、Component Adapters 与 Curated Overrides

Status: needs-info

## Parent

- `09C-D03-component-reader-presentation-framework.md`（原 `09C-B`，已拆分为
  09C-D01 / D02 / D03）

## What to build

把 09C-A 已验证的 Reader 与各 section 呈现契约扩展到 Draft Design System 的
全部适用 foundation domains 和当前 component inventory，并建立可审计的 visual
coverage 结果。

本 issue 补齐：

- Color：primitive、semantic role、component usage 的色板、前景/背景组合和适用的
  contrast preview；
- Materials：spacing、size、ratio、radius、border、shadow 和 opacity 的测量型样本；
- 09B component inventory 中全部非 gap 组件的 presentation 与 preview outcome；
- 对实际代码组件的 preview adapters；
- 对可由结构化 spec 表达的 Source-generated / Schematic renderers；
- 只影响呈现、不改变 canonical Design System facts 的 curated visual overrides；
- 跨 foundation / component 的 visual coverage audit 与 honest fallback。

Coverage 不是要求每个 entry 都生成一张独立图片，而是要求每个适用概念都得到一个
明确结果：

1. 被一个或多个 Visual Sample 消费；
2. 作为 Technical details 支持某个更高层样本；
3. 因数据不足或不适用而得到明确、可审计的 unavailable / not-applicable 结果。

每个非 gap component 必须进入统一 Component Reader，并得到 Code-backed、
Source-generated、Schematic 或 unavailable 中的一种结果。Unavailable 不等于失败，
但必须指出缺少的 anatomy、variant、state、responsive behavior、code link 或 adapter，
不能静默退化成没有内容的右栏。

Curated override 用于改善 sample composition、示例内容或呈现方式，不是新的 Design
System source。它必须引用现有 entry / component identity，不能覆盖 token value、
status、evidence 或 component contract；source 更新导致引用失效时应退回标准 renderer
并报告 stale override。

本 slice 完成时，Browser 应从“几个手工挑选页面具有可视化”升级为“所有适用 Design
System 内容都能得到一致、诚实、可维护的阅读与视觉结果”。

## Locked product decisions

- 继续复用 09C-A 的可拖拽双栏和 09C-D03 的 Component Framework（原 09C-B 的
  Visual Grammar 目标已按 section 拆分：Interaction 纯文本见 09C-D01，Layout
  source capture 见 09C-D02）。
- Color、Materials 与 Components 仍从 DB-backed view 派生；不新增平行事实源。
- visual coverage 以适用性和可追溯性为标准，不设固定截图数量。
- 每个 Visual Sample 记录所消费的 entry / component identities 和 origin。
- unavailable 是诚实结果；不得为了 coverage 指标制造不受支持的视觉决定。
- curated override 只能调整 presentation，不得改变 source、status、evidence 或
  approval write-back。
- 标准 renderer 必须始终存在；override stale 或失败时安全回退。

## Design prerequisite

开始具体实现前需要设计师确认完整覆盖用的 Figma reference，包括 Color、Materials、
通用 unavailable state、origin 标记、override 后的样本形态，以及当前 inventory 中
不同组件类型的代表页面。取得 reference 后可把 Status 调整为 `ready-for-agent`。

## Acceptance criteria

- [ ] Color Reader 把 primitive、semantic 和 component usage 组织为可读左栏信息，
      右栏呈现实际色板和适用的前景/背景组合。
- [ ] Color sample 只使用 source-backed value；candidate / gap 不会被表现成已确认
      palette。
- [ ] Materials Reader 与 renderer 覆盖当前适用的 spacing、size、ratio、radius、
      border、shadow 和 opacity domains。
- [ ] 每个非 gap component inventory entry 都进入统一 Component Reader，并得到
      Code-backed、Source-generated、Schematic 或 unavailable outcome。
- [ ] 有有效 code link 和 adapter 的组件使用真实实现；没有 adapter 时不会偷偷使用
      不相关的通用组件替代。
- [ ] Source-generated / Schematic sample 的 anatomy、variants、states、token links
      和 responsive behavior 均能追溯到当前 spec。
- [ ] unavailable outcome 显示具体缺失字段或 adapter，不留下无法解释的空白右栏。
- [ ] visual coverage audit 能列出 consumed、supporting-detail、not-applicable 和
      unavailable 结果，并能定位对应 entry / component。
- [ ] coverage audit 不以固定 entry 或 sample 数量作为成功标准。
- [ ] curated override 只能引用已有 identity 和 renderer contract，不能改变 canonical
      Design System value、status、evidence 或 approval。
- [ ] stale / invalid override 自动回退到标准 renderer，并产生可诊断结果。
- [ ] Design System 通过 ingest 或 approval 更新后，Reader、Visual Sample 和 coverage
      状态随 DB-backed refresh 一致更新。
- [ ] 自动测试覆盖 Color / Materials projection、component inventory coverage、
      adapter fallback、override stale 和 source 更新后的重建。
- [ ] 使用包含不同 foundation domains 和异构 component inventory 的 rich fixture，
      验证 09B 已抽取信息没有因 presentation coverage 静默丢失。
- [ ] 使用真实 Browser 按 Figma reference 完成全 inventory spot-check、responsive、
      keyboard、contrast 和 reduced-motion 核对。

## Real Agent validation

- [ ] 真实 Agent 使用包含 Color、Materials 与异构 component inventory 的 rich
      Alignment input 生成并声明 Draft Design System。
- [ ] Agent 对 visual coverage audit 做 source → presentation 与 presentation →
      source 双向抽查，确认没有静默遗漏或无证据视觉决定。
- [ ] Agent 更新一个 source token、重声明一个 component spec，并验证 Browser sample、
      coverage outcome 和 stale override fallback 随 DB-backed refresh 一致更新。
- [ ] 真实 Agent / Browser 记录与 coverage、adapter、override automated tests 分开保存。

## Open gaps

- 完整覆盖 Figma reference 尚未提供。
- Curated override 的持久化位置、authoring 入口和版本策略尚未锁定；实现不得在这些
  决策明确前新增 source file 或旁路事实源。
- 真实项目中哪些 code links 可以安全进入 Code-backed preview 需要在 09C-D03
  技术验证后确定。

## Blocked by

- `09C-D03-component-reader-presentation-framework.md`
- 设计师确认的 Design System Browser Figma reference

## Out of scope

- 不要求为未来未知组件预先编写 adapter。
- 不把 visual coverage 变成新的 Initial Design System extraction 完成门。
- 不让 curated override 成为可修改 Design System 规则的旁路。
- 不生成与当前产品无关的通用组件或通用 gap。
- 不改变 Issue 10 的 Seed reconstruction prototype 或 Issue 12 的规则更新流程。
