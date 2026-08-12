# 34 — Rule Update Review 设计方向 Prototype

Status: implemented(2026-08-11,设计师选定 **Mirror** 方向;文字状态说明见下,Figma 参考由设计师后续自行整理;探索用 Prototype 应设计师要求暂时保留)

## Parent

- `29-batch-rule-update-review.md`

## What to build

在设计师恢复本轮设计探索时，用隔离 Prototype 与可视 picker 共同确定 Design System Browser 中 Rule Update Review 的具体呈现方向。先探索最高杠杆的 Rule Update 卡片，再单独探索 Sidebar 左下角的 All interactions 页面；Prototype 只用于比较与讨论，不进入生产依赖，也不沿用此前未被选择的原型。

已确定的产品约束不再作为变量：保持 Sidebar + 单一主内容列；只在包含未完成 Rule Update 的对应类别显示绿点；提案卡默认折叠；相关交流在卡片内独立折叠；设计师直接修改提案；接受和拒绝是卡片上的单击动作；All interactions 使用 Sidebar 左下角入口并占用同一主内容区。

## Direction decision(2026-08-11)

探索在 `app/prototypes/rule-update-review/`(隔离路由,零生产依赖)进行,共两轮:

- **Round 1**(信号机制轴):Quiet(纯 chip)/ Rail(左侧 3px 色轨)/ Tinted(整卡底色)。设计师选择 Quiet 方向,但指出其与现有 Rule 的极简语言仍有差距,要求 riff。
- **Round 2**(riff Quiet,极简程度轴):**Mirror**(单个 chip 与 Rule 的 Confirmed chip 同位同规格)/ Dot(复用 Sidebar 5px 圆点语言)/ Inline(纯排版文字)。设计师选定 **Mirror**。

未选择方向(Dot、Inline 及 Round 1 的 Rail、Tinted)不进入实现依据。

### Mirror 方向生产 UI 状态说明(Issue 36–40 的实现依据)

**提案卡片(在类别规则流中)**:

- 卡片头与正式 Rule 卡完全同构:标题(13.5px/600)+ 同一位置、同一规格(24px 高、6px 圆角、12px)的**单个状态 chip**;chevron 遵循 Browser 的 hover-reveal 语言(hover/focus/展开时可见)。kind 与 revision 不出现在卡片头,降级为展开后的小字 caption。
- 状态 chip 二态且必须可区分:`Pending review`(绿 tint,同 formalized chip 的色处理 `rgb(17 197 20 / 9%)` / `#0f8f11`)与 `Waiting for Agent`(中性灰)。绿点语义 = 该类别有未完成 proposal(已接受待 Agent 写入仍算未完成,Agent 应用完成才消失)。
- 空间规则:`new` / `move` 提案置类别规则流顶部;`update` 紧贴目标 Rule 下方;`move` 在来源类别保留只读溯源行(虚线),点击深链到目标类别并展开高亮目标卡。
- 展开内容顺序:Proposed 正文 →(仅 update)Current 现行正文(灰底弱化块)→ Reason → Exchanges(独立折叠)→ caption(`Pending review · Update · revision 2 · edited by designer`)→ 操作行。
- **编辑与决定的竞态用结构消除**:进入编辑后操作行被 Cancel / Save revision 替换,Accept/Reject 在编辑期间根本不可达;空白或无变化保存不产生 revision;保存产生不可变新 revision 并记录修改者。
- Accept 单击生效(无确认弹窗),卡片转为 `Waiting for Agent` 灰态,操作行替换为 "Accepted · waiting for Agent to write the design system";Reject 单击生效,卡片以 grid-rows + opacity 收起退出(240ms ease-out),绿点按剩余未完成 proposal 重算。
- 接受转正后的新 Rule 落到类别内的语义排序位置(提案的顶部位置只是待审态,不是归位)。

**All interactions(Sidebar 左下角入口,占用同一主内容区)**:

- 按 review 分组(如 "Review 3 · from 「设置页 v2」 prototype validation");每条记录 = 一个决定事实:kind chip(Proposal / Revision / Accepted / Rejected)+ 规则名 + 事实描述(如 `Accepted · revision 2 · waiting for Agent`)。
- 可溯源标签:指向仍存在 proposal 的记录显示蓝色类别 tag(如 `Color →`),点击跳回对应类别、展开目标卡并播放一次蓝色 ring 高亮(约 1.2s);终局记录(rejected / 已合并为正式 Rule)显示静态标签(`Rejected` / `Applied as rule`),不再可跳转。
- ⓘ Info 按钮行内展开该记录的 Frozen transcript(Designer/Agent 登记版对话);页面顶部明确标注范围:"Only decisions and transcripts frozen by the Agent at review time appear here",不暗示可读取未提交的 host chat。
- Rejected proposal 与 superseded revision 保留审计可见,不重新出现在规则流。

**语言**:UI chrome 全部英文(sidebar、chip、按钮、块标签);设计系统内容(Rule/提案标题、正文、理由、交流)用中文。

**Motion**:入场 sheet 350ms drawer ease;展开/收起用 grid-rows 0fr↔1fr + opacity(≤220ms ease-out);picker 切换无动画;全部 `prefers-reduced-motion` 降级。

## Acceptance criteria

- [x] Prototype 与生产代码完全隔离,每轮只探索一个明确界面问题,并在真实 Design System Browser 上下文中提供三个真正不同的方向。(Round 1: 信号机制;Round 2: 极简程度)
- [x] 每个方向都可实际完成展开交流、直接修改、保存 revision、接受、拒绝与状态反馈;没有死按钮或占位交互。(浏览器逐项验证通过,零控制台错误)
- [x] 设计师明确选择方向或要求围绕某方向继续 riff,未选择的方向不进入实现依据。(Round 1 选 Quiet 并要求 riff;Round 2 选定 Mirror)
- [x] 选定方向被整理为生产 UI 所需的 Figma 参考与状态说明,之后删除探索用 Prototype,除非设计师明确要求保留。(设计师明确:文字状态说明即可,Figma 参考后续自行整理;Prototype 应要求暂时保留于 `app/prototypes/rule-update-review/`)

## Blocked by

None — can start when the designer schedules the Prototype round.

## Real Agent validation

- [x] 真实 Agent 建立 picker、逐个验证全部方向并把选择权交给设计师;选择结果和取舍被记录到本 issue。(两轮 picker 均由真实 Agent 构建并在浏览器逐项验证:展开/交流折叠/编辑保存 revision/编辑中竞态/Accept 转态/Reject 退出与绿点重算/move 溯源深链/All interactions 深链与高亮/Frozen transcript 展开)

## Open gaps

- ~~All interactions 是独立的第二轮探索~~ 已在 Round 2 与卡片同场完成(三个变体共享同一 All interactions 设计;若后续要 riff 其呈现,另起探索)。
- ~~Prototype 暂不开始;本 issue 完成前,后续生产 UI tickets 保持阻塞~~ 已解除:Issue 36 及以上说明为实现依据。
- 探索用 Prototype 暂时保留;生产 UI 落地并由设计师确认后,应删除 `app/prototypes/rule-update-review/` 并更新本记录。
