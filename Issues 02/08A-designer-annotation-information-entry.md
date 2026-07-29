# Designer Annotation 信息录入与卡片显示

Status: in-progress

## What to build

设计师在 Figma Evidence Surface 上创建自由标注时，放置 marker(click 或 drag)后立即弹出文本录入框(placeholder "Add your design intent..." + 发送按钮);提交的设计意图写入 annotation `body`，取代当前 Runtime client 硬编码的 `"Placeholder annotation"`(`components/runtime/runtime-client.ts:422`)。已填写标注以卡片形式显示在 Surface 侧栏:纯正文绿色卡片，经虚线 connector 回连画布上的 region marker。

Figma reference: `recursive-design-agent` file,node `670:891`(**修订版，以此为准**——下方为编辑模式录入框，上方为已填卡片);旧版 node `646:1320` 已被设计师作废。

范围边界:本 issue 只做**设计师主动标注**的信息录入、显示与编辑。不改动 06 的 target union 与几何语义;不改变 07 系列 Agent 对齐卡片(灰色 Agent Annotation / Question card)的任何行为。

本 issue 同时承接 06 明示留下的「Annotation 类型/权限的新语义属于下一 Issue」(06 第 13 行)。

### 设计决策(2026-07-29 与设计师确认;同日按 Figma 670:891 修订)

1. **取消标题**:卡片无编号标题(不做 "4. Root Layout" 式 title,也不做编号);卡片 = 纯正文。不新增 title 字段。
2. **Section 绑定 = 归属与可见范围**:设计师标注是对**当前所处 section** 的意见，创建时自动绑定当前六部分阶段(Design Principle / Visual Language / Token / Layout / Component / Interaction)——录入框不提供 section 选择;section 决定归属:在 Design Principle 里写的标注不会出现在其他环节(投影按当前阶段过滤，Agent 标注与无 section 旧记录始终可见)。record 新增 `section` 字段;设计师创建的标注必须带 section,Agent 创建的标注 section 可为空;旧记录以 `section: null` 保持可读。
3. **绿色是 User Annotation 专属色**:卡片与 connector 固定使用设计师绿(tint `#e9ffea` / border `#19d122`，与画布 marker 同色),**不按 section 着色**、无 anchor 徽章。
4. **新类型**:新增 annotation 类型 `designer_annotation`,作为设计师自由标注的类型(不复用 question / assumption / observed fact / generalization risk);设计师创建默认使用该类型，旧 `explanatory` 记录保持可读。
5. **可编辑**:点击已填卡片，出现与录入框相同样式的输入框(预填当前文字),设计师直接编辑;保存更新 body 并记录语义事件。
6. **堆叠与折线 connector(Figma 674-906 + 设计师补充)**:同车道卡片以 12px 间距堆叠;connector 从卡片垂直中心出发，分三种形态——①卡片中线与 marker 中线同行:水平直线直连 marker 最近垂直边中点;②卡片中线仍落在 marker 纵跨内(堆叠偏差小):双折线——先水平到车道空隙中点，再折到 marker 中线高度，最后水平进入 marker 最近垂直边中点(避免在上下边中点画出短促突兀的折角);③卡片完全离开 marker 纵跨:单折线——水平到 marker 中心 X，再垂直进入最近水平边(上/下)。拐角 8px 圆角;无论哪种形态，connector 都不进入 marker 盒。
7. **与 Agent question card 的碰撞体积**:设计师卡片与本 section 的 07 Agent question card 共享侧栏车道——question card 占位优先，设计师卡片以其为已占盒继续堆叠(12px 间距),两者永不重叠;question card 出现/移动/删除时设计师卡片即时重排。
8. **录入框定位**:录入框生成在 marker 靠近的边框一侧、**frame 外**，与 annotation marker 水平方向对齐;不遮挡画布内容。

## User stories covered

- 70(设计师自己创建 Region Annotation——补全其缺失的信息录入半边)
- 74(类型视觉区分:Designer Annotation 绿色 vs Agent 灰)
- Figma node `670:891` 的六步抽取环节设计师标注体系(无独立编号 story,以 Figma 为准)

## Acceptance criteria

- [ ] 设计师放置 annotation marker(click 或 drag)后，在 marker 旁弹出文本录入框;**提交时才创建 Runtime record**——取消(Esc)不留 marker、不落库(PRD 50:草稿不进入研究事实)。
- [ ] 录入框视觉遵循 Figma 670:900:白底、绿色边框、placeholder "Add your design intent..."、右侧圆形绿色发送按钮;Enter 提交、Esc 取消。
- [ ] 设计师创建 annotation 自动绑定当前六部分阶段为 section;`type` 持久化为 `designer_annotation`;`body` 持久化为设计师输入文本;Workbench 创建链路不再发送 `"Placeholder annotation"`。
- [ ] 已填标注显示为侧栏绿色卡片(Figma 670:895:`#e9ffea` 底 + `#19d122` 边 + 纯正文，无徽章);卡片与画布 marker 之间有绿色虚线 connector——卡片与 marker 同行时为水平直线，被堆叠挤离时为 8px 圆角折线(Figma 674-906),直连 marker 边缘且不进入 marker 盒。
- [ ] 同车道卡片 12px 间距堆叠;设计师卡片与本 section Agent question card 互不重叠(question card 占位优先，设计师卡片避让并随其变化即时重排)。
- [ ] 录入框生成在 marker 靠近的边框一侧、frame 外，与 marker 水平方向对齐。
- [ ] Section 可见范围:设计师标注只在所属阶段显示(切换阶段后其他阶段的标注 marker 与卡片均不出现);Agent 标注与 `section: null` 旧记录始终可见。
- [ ] 点击已填卡片进入编辑:输入框预填当前 body,Enter/发送保存、Esc 取消;保存后 Runtime 持久化新 body 并记录语义事件,Workbench 即时刷新。
- [ ] Agent 创建的灰色 marker 行为不变;07 系列对齐卡片行为不变。
- [ ] Runtime schema migration 新增 `section` 列;旧记录(placeholder body、`section: null`、`explanatory` 类型)保持可读。
- [ ] 测试覆盖:提交持久化设计师 body/section/type、缺 section 的设计师创建被拒绝、Esc 取消不留 record、body 更新持久化与事件、卡片投影回连 record id、阶段过滤、旧记录可读。

## Real Agent validation

- [ ] 设计师在真实 Figma Evidence Surface 上创建标注并录入文本;SQLite 中 `body` 为输入文本、`type` 为 `designer_annotation`、`section` 为当前阶段;Workbench 卡片显示与 record 一致。
- [ ] 设计师编辑已填卡片 body;SQLite 与 Workbench 同步更新，语义事件可查。
- [ ] Agent 经语义 MCP read surface 能读到设计师录入的 body/section(与 06 的 anchor/candidates 一起),不需要从 tldraw 状态猜测。

## Likely difficulties for Agent

- 录入 UI 与 tldraw 工具状态机的集成:pointer-up → draft shape → popover → submit 才创建 record;取消路径要可靠清理 draft shape 与工具状态。
- 侧栏卡片停靠布局与 connector 在 camera zoom / surface resize 下的几何:必须复用 06 的 normalized rect 与 media-box 映射，不发明第二套坐标;connector 几何不得覆盖 marker 命中区域。
- Section 语义复用:与 07(alignment section)共用同一组六部分定义，避免第二套 section 枚举。

## Suggested ways through

- 沿用 06 原则:tldraw shape 只存 record id 与 display geometry;卡片渲染只读 Runtime record,body/section 从 record 派生。
- popover 未提交状态只保留 tldraw draft shape;`create_annotation` 是唯一落库入口，校验错误原样返回。
- body 编辑走独立 mutation(参照 delete 的 designer-only 产品规则),记录独立语义事件并广播 record invalidation。
- section 直接取 Workbench 当前阶段(AlignmentStagePanel 的 currentStage),创建与投影过滤共用同一来源。

## Blocked by

- 06(已完成)。本 issue 排在 08 之前;与 08/09 的 extraction UI 协调点是 section 面板(本 issue 做创建时的阶段绑定、卡片显示与按阶段过滤;完整六部分抽取面板属于 08/09)。
