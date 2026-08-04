# Layout Source Capture：原设计截图作为视觉 Anchor

Status: resolved

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

- [x] 抽取契约支持 layout 规则声明 node 级 Source Capture provenance，并在真实
      抽取中记录验证结果
- [x] Layout leaf 以 Placard 并列呈现 Source Capture 截图与规则文本，截图可回溯
      到来源 node
- [x] `Source capture` origin 标记在 UI 与 accessibility tree 中可辨认；无截图时
      明确区分 unavailable
- [x] 截图显示捕获时间；无 capture 时呈现明确 unavailable 而非伪造视觉
- [x] Blueprint / Isolate / Compose 已按后续锁定决策退役，相关 split 回归迁移至
      Color leaf
- [x] provenance、截图契约与投影有确定性 unit / e2e tests；真实 Browser 核对与
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

### 2026-08-01 — Placard 晋升，Blueprint 整体退役（取代上文「Blueprint 保留」）

原型探索（Placard / Spec Sheet / Overlay 三方向）后设计师选定 **Placard**：纵向
区块流，每规则一区块——截图挂 hairline 框，其下 statement、一行 facts、来源
caption。据此修订上文「Blueprint 保留」条款：**Blueprint 层不保留**——解析值
组合的 schematic 永远无法呈现布局真实样貌，而 capture 可以；Anchor wiring /
Isolate / Compose / LayoutSamples 随 Blueprint 一并退役。Layout leaf 改为整页
page 流（不再是 split leaf）；split/divider 行为由 Color 等 token leaf 承接，
e2e 的 split 回归已迁移至 Color leaf。

**图片限高**：capture 以 `max-height: 340px`（`max-width: 100%`）约束，不同比例
截图不会把 placard 体部顶出阅读节奏；多条 capture 时提供缩略条切换。

**截图获取策略（契约，不经 Runtime 抓取）**：Agent 在抽取时用宿主的 Figma MCP
对规则对应 node 截屏，PNG 存至 `design-system/captures/`，并在
`layout-rules.json` 的规则 value 里声明 `sourceCaptures`——`nodeName` /
`artifactPath`（项目相对路径）/ `capturedAt` 必填，`nodeId` / `surfaceId`
有 provenance 时填。该字段已进 schema 校验（`validateLayoutRulesFile`）与
`source_contract.layout_rule_capture_field` 指引；无真实 capture 的规则不写
该字段，Browser 呈现 honest unavailable，绝不伪造。

**Runtime 装饰与陈旧判定**：view 把合法 `sourceCaptures` 装饰为
`layoutCaptures`；`surfaceId` 指向的 surface 被 supersede 或已不存在时标记
`stale`（caption 显示 `· stale`）。「View in frame」经新端点
`/api/evidence-screenshot?id=<surfaceId>` 打开整帧 lightbox（portal 到
document.body，capture 相位 Esc 不关闭 sheet）。

真实 Browser 已在 `ikran test 7`（未声明 captures）核对：四条规则全部呈现
虚线 honest unavailable 占位，statement / facts / origin / 审批入口无回归。
capture 渲染、限高、缩略条、stale、lightbox 由 unit 与 reader e2e 确定性覆盖，
全量 `npm run check` 通过。

**覆盖率验证记录（范围声明）**：验收项「规则 → node provenance 覆盖率验证」
本次未落地——`nodeId` / `surfaceId` 定为可选（有 provenance 才填），当前测试
项目（`ikran test 7`）尚无任何真实 capture，覆盖率无从统计。该验证随下次真实
抽取（Agent 走 Figma MCP 按上文契约生成 captures）时一并记录。

**Review 修订（2026-08-01）**：lightbox 的「View in frame」仅在 capture 自带
`surfaceId` 时出现——去掉了回退到 entry 首个 evidence version 的逻辑，避免
展示与 capture node 无关的对齐期整帧。

### 2026-08-02 — Source Capture v2：固定比例定位视图（取代 340px 限高与整帧 lightbox）

真实抽取后暴露的问题：node 比例奇怪时（46px 高的 sticky bar、3586px 高的整页
frame），直出截图要么成细条、要么顶天立地，严重降低易读性；而「点开看清晰
大图」本身价值有限——需要细看时设计师可以回到 Figma 画布。这个界面的截图
职责是**让人对「这条规则指的是哪里」有概念**（定位视图，locator view）。

据此与设计师确认的 v2 决策：

- **固定比例裁切**：capture PNG 一律裁成含 node 的 **3:2（横向）/ 2:3（竖
  向）**区域，按 node 取向选档。Nav bar 之类极端比例因此必然带周边上下
  文；整页 frame 只取顶部一段任其截断——文字描述足以补全语义，易读性优
  先。PNG 按精确比例导出，Browser 以 `object-fit: contain` 显示（mark 坐
  标因此恒对齐）。
- **位置标注常显**：`sourceCaptures` 新增可选 `nodeRect`（node 在裁后 PNG
  内的 bounds，0–1 fractions，Agent 由 Figma metadata 确定性算出）；有
  `nodeRect` 且 node 面积 < 0.85 时叠加 hairline 矩形（Human Annotation
  绿 `#19d122` + 白 halo，亮暗图均可读；不复制画布标注的框内阴影）。面积 ≥ 0.85 视为「图即 node」不再标注。裁切截断 node 时
  width/height 允许 > 1（schema 上限 4），面积超阈值自然不画 mark，取向
  判定也不受影响。
- **退役「View in frame」与整帧 lightbox**：只删查看入口；`surfaceId` 保
  留，stale 判定不变。`/api/evidence-screenshot` 端点（唯一消费方是
  lightbox）一并删除。
- 多 capture 保持主图 + 缩略条；portrait figure 限高 480px 居中（可调）。

契约更新落在 `source_contract.layout_rule_capture_field` 指引（3:2/2:3 裁
切、过大取顶、精确比例、nodeRect fractions）。Schema / view / projection /
Browser 单测与 reader-split e2e 全部改写覆盖；`ikran test 7` 已按 v2 重抽五
张 capture 并在真实 Browser 核对：Redo（亮图）/ Titan（暗图）标注框可读，
sticky bar 呈顶部细带 + 完整页面上下文，pageNarrative 呈限高居中的顶部截断
竖图，无 View in frame。全量 `npm run check` 通过。

### 2026-08-04 — 关闭

设计师确认 v2 Source Capture 方案及既有验收记录满足本 issue。原 Acceptance
Criteria 中已被后续决策取代的 Blueprint 与 provenance 表述同步修订，状态更新为
`resolved`。
