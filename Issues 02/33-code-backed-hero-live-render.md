# 33 — code-backed hero 活渲染(09C-D03 后续 slice)

Status: partial（截图无关 Live iframe 路径已落地；Real Agent validation 待做）

09C-D03 Slice 1(commit `c2090ff`)明确推迟的「code-backed hero 活渲染、
states hover 真切换」由本 issue 承接。issue 32 已提供 code-backed 的
静态形态(代码渲染截图)与回退档;本 issue 把组件详情 hero 升级为
**真实代码活渲染**,states hover 从只读/换图升级为切换真实状态。

09C-D03 记录的 open gap 是本 issue 的前置:「Code-backed adapter 的安全
装载边界和可支持的组件运行环境需在实现前结合现有 Workbench runtime 做
技术验证」。

## 锁定决策

1. **前置 spike 先行**:Code-backed adapter 的安全装载边界(沙箱/
   iframe 隔离、可支持的组件运行环境、依赖范围)结合现有 Workbench
   runtime 做技术验证,结论(可行边界与装载方案,或不可行原因)记录
   在本 issue Comments 后才进入实现。
2. **活渲染 hero**:code-backed 档从 32 的代码渲染截图升级为活组件;
   states hover 切换真实状态(取代 capture 换图/只读名称行)。
3. **失败显式回退**:装载失败按 live → source-capture → unavailable 的
   档位链回退并标明原因;旧 code screenshot 不再是产品档。空白是事故,
   unavailable 是结论(沿用 D03 原则)。
4. 活渲染保持 iframe 沙箱边界,但允许组件内部的原生指针交互(default 可直接
   hover);states 行仍用于强制 focus-visible、disabled 等声明状态。不提供宿主
   preview controls、跨 frame 控制或 Runtime API 能力。

## 验收

- spike 结论记录在 Comments:装载边界、运行环境清单、安全模型。
- 组件详情 hero 为活渲染组件,hover 切换真实 state;无 code-backed
  条件的组件行为与 32 之后完全一致。
- 装载/渲染失败显式回退到静态档并标明原因,无空白 hero。
- `npx tsc --noEmit` 干净;全量 vitest 绿;相关 playwright spec 通过。

## Real Agent validation

- 真实项目内至少一个组件(Sticky Navigation 级,含真实 states)完成
  活渲染 + hover 真切换,设计师在真实 Browser 中确认(真实 smoke,
  与 automated 测试分开记录)。

## Open gaps

- 多组件/跨 surface 同时活渲染的性能边界。
- preview controls、anatomy overlay(D03 同批后续项)是否另立 issue,
  待本 issue 落地后重估。
- 活渲染组件对项目依赖版本(React 版本、样式体系)的兼容矩阵。

## 明确不做

- preview controls、anatomy overlay。
- 宿主 preview controls、跨 frame 事件桥接与 Runtime API 访问。
- code-backed 档之外的呈现形态变更。

## Blocked by

- 32(code-backed capture 通道与静态回退档)。

## Comments

### 2026-08-07 — 前置 spike 结论:可行,推荐「live iframe + harness 路由 + query param 切 state」

**验证方法**:(1) 通读 `components/workbench/prototype-surface-shape.tsx`、
`lib/runtime/prototype-surface.ts` / `preview-server.ts` / `rule-capture.ts` /
`design-system-code-capture.ts` / `session.ts`、`components/workbench/design-system-browser.tsx`
与 `design-system-view-model.ts`;(2) 起双 localhost server(同 host 不同 port =
跨源)复现 Workbench UI ↔ preview dev server 拓扑,用 playwright-core 无头浏览器
跑探针(脚本 `.scratch/spike-33/probe.mjs`,一次性 spike 产物)。探针结果:
sandboxed(`allow-scripts allow-same-origin`)跨源 iframe 正常渲染并执行脚本;
query param 重导航切换 state 生效(`default` → `hover`);iframe 尝试 top
navigation 被 sandbox 拦截(`DOMException`,父页 URL 不变);父页无法读跨源
iframe DOM(state 读取只能走 URL 约定,不能靠 DOM 检查);CSS 裁切视口
(overflow hidden + 偏移 iframe)渲染正常。

**Q1 安全装载边界 — 与现有 surface 嵌入同边界,无新增信任面**。现有 surface
活预览(`prototype-surface-shape.tsx:325-341`)以
`sandbox="allow-scripts allow-same-origin"` iframe 嵌入
`http://127.0.0.1:<port>`(preview-server.ts `previewUrlForPort`),Workbench UI
在 `127.0.0.1:3000` —— 不同 port 即跨源,iframe 拿不到父文档与 session
token。session token(`lib/runtime/session.ts`)只守 Workbench 自己的
`/api/*`:iframe 内跨源 fetch 带 Origin header 会撞 `cross_origin` 403,不带
token 撞 `invalid_session` 403——Agent 写的项目代码在 iframe 里调不动 Runtime
API。preview URL 本身无 token,但那是 issue 30 既有面(且 Next dev 默认绑
0.0.0.0,LAN 可达,hero 不放大该面)。hero 嵌入沿用同一 sandbox 形态、同一
preview URL,信任边界与 canvas surface 完全一致;额外考量只有一条:issue 33
锁定「只读呈现」,hero iframe 应 `pointer-events: none`(surface 的可交互是
canvas 场景的决策,不自动继承到 hero)。

**Q2 运行环境 — 「Runtime 不执行项目代码」边界成立;harness 路由是必需新增
约定**。渲染全部发生在 Runtime spawn 的项目 dev server 进程
(`preview-server.ts` 只 probe URL),截图发生在 headless Chromium
(`rule-capture.ts`),Runtime 从不 import 项目代码。单组件挂载:项目里没有
能渲染单个组件的现有路由——surface 全部是整页(`record_preview` 的
surface = previewable page;本仓库 `app/prototypes/` 也只有整页)。两条路:
(a) 复用 32 的「surface + 区域」裁切嵌入——技术可行(探针第 5 项)但 32 的
capture record 不落 crop、区域坐标对布局变化脆弱,且**裁切无法切 state**;
(b) 约定 harness 路由(如 `/__ikran/component/<entryId>?state=...`),由
Agent 在 prototype app 内写作并显式声明。结论:**states hover 真切换只有
harness 能成立**,(a) 保留为 32 静态 capture 的既有约定,不进 hero。harness
代码归属项目工作区、由 Agent 显式声明路径,恰好落在「Agent 显式声明、
Runtime 不自动匹配」原则(31 决策 5)内。成本:harness 是 Agent 侧写作指引
+ Runtime 侧一个声明字段,远小于在 Runtime 内建组件渲染器(后者直接违背
边界)。

**Q3 生命周期与回退 — 机制全部现成,直接复用**。检测:DB 里的 surface
record(`readiness` / `stale` / `stale_reason` / `preview_url`)经
`GET /api/prototype-surface` 可读;32 的 capture record 已带 `surfaceId`,
hero 按它 join 即可。复用清单:`runtime_shutdown` park + 重启 restore
(29a8d6b,`restorePrototypePreviewsOnce`,`GET /api/prototype-surface`
自带 fire-and-forget 触发);`code_changed` / `dev_server_exited` stale
语义(issue 30「never auto-restart」);`codeCaptureDigest` 的文件 digest
stale(32)。语义注意:digest stale 对 live **不应**构成回退——live 永远渲染
当前代码,digest stale 只标记静态兜底 capture 不再匹配代码;harness 随代码
移动而失效时靠 hero 端 iframe load 超时(建议 ~5s)检测,显式落静态档并注明
「preview unreachable」。回退链:live → code capture(32)→ source capture
→ unavailable,每档带原因 caption,无空白。

**Q4 states 切换机制 — 推荐 (a) query param 重导航**。三案对比:(a)
harness 路由 query param(`?state=<name>`):无 JS bridge、跨源与 sandbox
天然兼容(探针第 2 项实证)、state 名单一真源在 spec `stateMatrix`,改动面
= harness 读 searchParams + hero 改 iframe src;有 `?v=` 先例
(`app/prototypes/component-detail/page.tsx`)。hover 抖动用 ~150ms 防抖 +
移出恢复默认即可。(b) postMessage:harness 仍要写 listener,多一条消息协议
+ origin 校验,换来的只是不重挂载——v1 不值得,留作后续优化。(c) Agent 在
harness 内自带切换器:违背设计师确认的「hero states 行 hover 驱动」交互
(09C-D03 Placard 决策),且重复造 UI,否。结论:harness 路由本身是必需
(见 Q2),在 harness 之上 (a) 最小且最契合「Agent 显式声明」——harness
路径与 state 参数约定都是声明物。

**Q5 结论:可行,不做否决**。推荐实现形态与契约草案:

1. **声明**:扩展 32 的 `capture_component_code_hero` 新增可选 `harnessPath`
   (或并列新工具 `declare_component_live_hero`,实现时二选一)。Runtime 校验
   `harnessPath` 为同源相对路径(`/` 开头、无 `..`、无 scheme/authority),
   校验通过写回 capture record 新字段 `harnessPath`(仅 `origin: "code"`
   有意义);states 名单不重复声明,取自 spec `stateMatrix`。
2. **harness 约定**(写作指引进 tool description / MCP instructions):Agent
   在 prototype app 提供 `<harnessPath>?state=<name>`,缺省 props 挂载单组件、
   按 `state` 切换;纯呈现,无 postMessage 义务。

3. **view 模型**:`DesignSystemLayoutCapture` 增 `harnessPath`;Runtime 的
   design-system view 把链接 surface 的 `readiness` / `stale` / `previewUrl`
   装饰到 capture view(守住 DSB「只读 /api/design-system」数据纪律,不引
   第二个 fetch)。
4. **hero 行为**:live 条件 = `origin === "code"` + 已声明 `harnessPath` +
   链接 surface `ready` 且非 stale;iframe 沿用
   `sandbox="allow-scripts allow-same-origin"` + `loading="lazy"`,加
   `pointer-events: none`(锁定决策 4);states 行 hover/focus 防抖更新
   `state` query;load 超时 / surface 非 ready → 按回退链落静态档并 caption
   注明原因。
5. **明确不做**(本次):postMessage 协议、裁切区域活嵌入、组件内交互、
   多组件并发活渲染的性能治理(open gap 保留)。

工作量粗估:Runtime 侧(声明字段 + 校验 + view 装饰 + 单测)0.5–1 天;
Browser 侧(live hero + 回退档 + states hover + e2e fixture)1–1.5 天;
契约文案 + Real Agent 验证(ikran test 7 类项目,Sticky Navigation 级)
0.5 天。合计约 2–3 天。

遗留待实现时定:多组件详情页连续浏览时 iframe 挂载上限(open gap 同款);
harness 失效的 Agent 侧修复引导文案。

### 2026-08-08 — 实现记录(commit `c8eaff0`,已推送)

按上方 spike 契约落地:

- 扩展 `capture_component_code_hero` 可选 `harnessPath`(不并列新工具:保持 32 的「一次声明一条 code capture、重触发整体替换」单写入口)。同源相对路径校验 `isCaptureHarnessPath`(`/` 开头,禁 `//` `..` `?` `#` 反斜杠)收拢在 schema 层,声明门/工具输入/view 防御解析三处共享;`harnessPath` 只允许出现在 `origin: "code"` capture 上。
- view 装饰:code capture 的 surfaceId 实时 join prototype_surfaces,下发 `previewUrl` / `surfaceReadiness` / `surfaceStale` 随 `GET /api/design-system`(守住 DSB 单 fetch 纪律);source capture 不 join(它的 surfaceId 是 Figma 证据谱系)。
- hero `planComponentHero` 纯函数分档:live(code capture + harnessPath + ready 且非 stale)→ static + 原因 → source → unavailable;回退原因三值 `surface_not_ready` / `surface_stale` / `live_unreachable`,文案均以 "showing the code render" 收尾;**digest stale 不回退 live**。无 harness 的组件与 32 逐字节平价(有回归测试)。
- live iframe:`sandbox="allow-scripts allow-same-origin"` + `pointer-events: none` + tabIndex -1;states hover 150ms 防抖重导航 `<harnessPath>?state=<name>`(state 名单取自 stateMatrix;focus 移出行才恢复默认);5s 无首次 load → `live_unreachable`。verdict 键控 `componentHeroLiveKey`(含 readiness/stale 段,各段 encodeURIComponent):readiness 翻转(starting→ready)自动重试,终态不循环 flicker;可测接缝为纯 reducer `heroLiveVerdictReducer`。
- MCP instructions 未加词(预算余量仅 12 字节),harness 约定全部写进 tool description + zod 字段描述。
- 验证:tsc 干净;全量 vitest 1131 绿;playwright 两 spec 通过。双轴 code review 修复:回退文案拆分、readiness 重试语义(原注释与实现矛盾)、verdict 状态机测试、双排序/双 plan 调用消除、focus 闪烁、liveKey 撞键。
- 遗留:live-hero 端到端(含 Sticky Navigation 级真实组件 + 设计师确认)属 **Real Agent validation**,setup 见 `docs/real-agent-validation-issues-31-33.md` Flow C;写回形状已三处同形复制(formalize/31/32),第四处出现时提取共享模块;`LiveSurfaceInfo` data clump 重构未做。

### 2026-08-08 — 真实 Agent 验证修订:Live 声明与 screenshot 解耦

真实 Agent 用旧契约为三个组件连续调用截图工具时,同一 Prototype 页面被打开
六次;同时 harness/code 声明把 surface 标成 `code_changed`,Browser 因此从
已有截图切成空白 stale frame。修订后的 Active 契约如下:

1. Agent 先写完**全部** standalone harness route,并逐个
   `record_artifact_written`;不得边写一个边截图/刷新一个。
2. 全部代码声明完成后只调用一次 `record_preview`,恢复关联 surface 为
   ready/non-stale;显式传该页面的 `routePath`,因为 `sourceArtifactPath` 不承担
   框架路由推导。
3. 一次批量调用 `declare_component_live_heroes`,显式传
   `entryId + surfaceId + harnessPath + harnessArtifactPath`。Runtime 只校验并
   写回 `value.liveHero`,不启动浏览器、不截图、不生成 PNG。
4. Browser hero 固定分档为 live iframe → source capture → unavailable。
   surface stale/not-ready、harness load timeout 都显示明确原因并保留 source
   fallback,绝不展示空白 frame。
5. 旧 `origin: "code"` screenshot 会在新的 live 声明写回时从 Active
   captures 中退休;MCP catalog 不再注册 `capture_component_code_hero`。
6. harness 文档必须局部隐藏框架开发 chrome,不得为了组件 hero 全局关闭
   普通 Prototype 的调试入口。Next.js harness 使用
   `nextjs-portal { display: none !important; }`;外层 `/` preview 的 Dev
   Tools 保持原配置。
7. 2026-08-08 的真实 Browser 反馈覆盖 spike 时的「pointer-events:none」
   假设:live iframe 开放原生 pointer events,default 状态可直接触发真实 hover;
   sandbox、跨源隔离和无 Runtime API 访问边界不变。states 行继续承担强制状态。

实现还修复了 legacy top-level `sourceCaptures` 与 `value.sourceCaptures` 的
合并优先级,避免 live 声明误丢 Figma fallback。自动化覆盖 batch 声明、无
code screenshot 事件、stale gate、view 装饰以及 Browser 分档。

### 2026-08-08 — live hero 自适应尺寸补充

设计师实测发现固定 `240px` iframe 会裁掉 Project Strip 等大组件。尺寸契约
补充为：`240px` 仅是小组件的最小展示框；高组件按实际内容撑开；仅当内容
宽于 hero 可用宽度时等比缩小，外框始终完整包裹渲染结果。

这条补充取代上文「无 postMessage 义务 / 本次不做 postMessage 协议」中仅与
**几何尺寸**有关的部分。2026-08-08 的首版消息只含 body 的 `width/height`；
它已被下方 2026-08-10 的 version 2 root-bounds 协议取代。协议始终只承载
几何，不承载 DOM、设计数据、session 或 Runtime API 能力，原安全边界不变。

### 2026-08-10 — 真实 Agent 反馈：live component 自动居中

真实 Text Link harness 暴露了尺寸补充中的两个耦合缺口：harness 上报
`document.body.scrollWidth` 时，小组件会被浏览器默认 block 布局误报为整个
iframe viewport；Browser 随后又把该 full-stage iframe 固定在 `(0, 0)`，所以
组件视觉中心落在展台左上，而不是 D03 已锁定的「组件居中」。

Active 几何契约改为 version 2：harness 用唯一
`[data-ikran-component-root]` 紧包组件及其交互 halo/portal，marker 自身不得
transform、不得有负向 overflow；`html/body` 归零且禁止文档滚动。每次挂载、
root resize 与 viewport resize 都从同一坐标系上报
`{ type, version: 2, href, x, y, width, height }`。`href` 绑定当前 state 导航，
helper 必须在每次 default/state document 安装时捕获该 href，避免旧 document
的迟到消息覆盖新 state；Browser 同时校验 source、preview
origin、精确 href、有限非负 bounds，且 root 横向 extent 必须完整落在
1133px presentation viewport 内。

Browser 保留与 Prototype screenshot 相同的 1133px fixed presentation
viewport，只平移 iframe 让 root 的视觉中心落到展台中心；过宽 root 等比缩小，
这里「过宽」只指宽于 hero 展台、但不超过 1133px 的 root。240px 只保留为
最小展台高度。每次 default/state 导航的有效 v2 bounds 到达前 iframe 隐藏；
父侧用 `liveKey + href` 绑定该次导航的 loaded/timeout verdict，旧 state 的迟到
消息或 timer 不能结算新 state，连续 state 导航也会各自重启完整 5 秒窗口。5 秒
仍无有效消息则走现有 source-capture/unavailable 回退。旧 body-size/v1 harness
不会被静默当成已居中，必须迁移到 v2。Runtime 仍不跨源读取或改写项目 DOM；
sandbox、pointer interaction 与 state query 的其余契约不变。
