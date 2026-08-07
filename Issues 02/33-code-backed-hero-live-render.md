# 33 — code-backed hero 活渲染(09C-D03 后续 slice)

Status: ready-for-agent

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
3. **失败显式回退**:装载失败按 32 → source-capture → unavailable 的
   档位链回退并标明原因;空白是事故,unavailable 是结论(沿用 D03
   原则)。
4. 活渲染只读呈现,不提供组件内交互能力(preview controls 明确不做)。

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
- 组件内交互/事件响应(纯呈现)。
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
