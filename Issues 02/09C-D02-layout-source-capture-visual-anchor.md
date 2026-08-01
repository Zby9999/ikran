# Layout Source Capture：原设计截图作为视觉 Anchor

Status: ready-for-agent

## Parent

- `09C-A-design-system-reader-projection-resizable-split.md`

## What to build

Layout leaf 的视觉主体改为 **Source capture**：每条规则并列呈现其对应原设计的
截图与该规则本身。设计师核对规则时直接看到「这条规则来自原设计的哪里」，
Agent 不再为 Layout 创造任何可视化呈现。

Layout 规则有强烈的视觉 anchor——它们本来就来自设计中的视觉元素，因此截图是
诚实且充分的视觉呈现；这与 Interaction（无 anchor、纯文本，见 09C-D01）不同，
两类不再共用一套呈现假设。

**前置：规则 → node 级 provenance**

- 当前 evidence 链只到 frame 级（`evidence_versions.frame_node_id`）；整帧截图中
  目标元素过小会降低核对价值；
- 抽取时需为每条 layout 规则记录其来源 Figma node（05A 已具备 node screenshot +
  positional index 的捕获基础设施），Browser 端按 node 检索 / 裁剪对应截图；
- 实现前先验证：当前抽取产物中规则 → node 链接是否存在、覆盖率与可靠性如何；
  验证结果决定本 issue 的 provenance 改造范围。

**Source capture 呈现契约**

- origin 框架新增 `Source capture` 档位，排在 Code-backed / Source-generated /
  Schematic / unavailable 之上——它是最诚实的一档，origin 标记对设计师可见；
- 截图显示捕获时间（`evidence_versions.created_at`）；Figma 文件变更后的陈旧
  截图可辨认，刷新机制与 05C evidence refresh 衔接；
- 无 capture 的规则（非 Figma 来源、paste capture、上传图片、历史无链接数据）
  走 honest unavailable，不伪造视觉、不自动产生新 gap；
- candidate / formalized / gap 状态与审批、evidence 行为无回归。

**Blueprint 保留**

- 已实施并验证的 Layout Blueprint（0d827b6，split panel 内的 schematic 层）
  保留不动；2026-07-31 锁定的页面化 schematic 决策（最小充分场景、已知 /
  上下文 / 未知的视觉边界、`Schematic` origin、`Not to scale`、Isolate /
  Compose）继续适用于 Blueprint 层；
- Source capture 是主视觉，Blueprint 是规则语义的 schematic 补充；二者的分工
  与并存在实现时确认，不强行合并为一张图。

## Locked product decisions

- Layout 与 Interaction 不混为一谈：Layout 有视觉 anchor 走截图，Interaction
  无 anchor 走纯文本（09C-D01）。
- 截图即 source 本身，Agent 不为 Layout 创造可视化；截图不可用时诚实降级。
- 生成式 UI 规则（09C-B03 设计师锁定：封闭词汇、固定组合优先级、源值原文
  标注、禁止按规则 / 项目特判）继续约束 Blueprint 等 schematic 渲染器。
- 截图是 seed 时刻的证据快照，不声称代表 Figma 文件当前状态。

## Acceptance criteria

- [ ] 抽取产物为每条 layout 规则记录 node 级 provenance，并有覆盖率验证记录
- [ ] Layout leaf 每条规则并列呈现 Source capture 截图与规则文本，截图可回溯
      到具体 node
- [ ] `Source capture` origin 标记在 UI 与 accessibility tree 中可辨认，与
      Code-backed / Source-generated / Schematic / unavailable 并列区分
- [ ] 截图显示捕获时间；无 capture 时呈现明确 unavailable 而非伪造视觉
- [ ] Blueprint 层行为无回归（Isolate / Compose、anchor 对应、schematic origin）
- [ ] provenance 投影与截图检索有确定性 unit tests；真实 Browser 核对与
      deterministic tests 分开记录

## Open gaps

- 当前抽取产物中规则 → node 链接的现状未验证；若缺失，provenance 需进抽取
  契约（与 09C-D01 的契约修订同批进行）。
- 截图存储 / 检索路径（DB / artifacts）与 Browser 读取方式需在实现前结合
  05A 捕获产物做技术确认。

## Blocked by

- 无（05A 捕获基础设施已完成；契约修订可与 09C-D01 并行）

## Out of scope

- 不重建 Layout Atlas 卡片流（09C-B03 的 Atlas 方向已回退，保留 split panel）。
- 不为无 capture 的规则生成替代性装饰视觉。
- 不做 Figma 文件变更的自动监听；刷新走 05C 既有路径。

## Comments

### 2026-08-01 — 方向决策（取代 09C-B 的 Layout 部分）

设计师确认：高度不确定的规则有同一个确定来源——原设计。呈现原设计截图 +
 规则本身，既让设计师理解规则对应的原设计，又消除 Agent 自创可视化的不确定性。
Layout 因强视觉 anchor 采用此方案；Interaction 因无 anchor 且策略为高概念散文，
走纯文本（09C-D01）。原 09C-B 文件已删除，2026-07-31 页面化 schematic 决策
移至本文件继续生效（约束 Blueprint 层）。
