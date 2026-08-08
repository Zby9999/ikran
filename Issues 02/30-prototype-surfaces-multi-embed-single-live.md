# 30 — Prototype Surface 多嵌单活(Multi-Embed, Single-Live)

Status: partial（Runtime + 画布 UI 已落地且有单测；2026-08-07 补齐截图占位、缩放渲染与交互修复并在真实画布端到端核验；Real Agent validation 未做）

## What to build

让 Agent 创建或更新 prototype code 并声明 source artifact;Runtime 管理本地 dev server lifecycle(installing / starting / ready / failed,不用模糊 loading)、稳定 preview URL 与 `record_preview`,创建 Prototype Evidence Surface。Seed reconstruction prototype 的 run metadata 必须记录使用的 Seed Reference ids / evidence versions 与 design-system version(沿用原 Issue 10 的 2026-07-12 收口)。`record_preview` 的 run/surface upsert 与 `prototype_preview_declared` 事件在同一 SQLite 事务内落库(record+event 同事务,2026-08-06 补齐);readiness 的 ready/failed 另记 `preview_started` / `preview_failed`,stale 记 `preview_stale`。

画布形态:**多嵌单活**——tldraw 画布可共存多个 Prototype Surface(自定义 shape,HTMLContainer + iframe,复用 `workbench-embeds.ts` 预留的 embed 意图),但**只有被 focus 的 surface 是 live iframe,其余显示截图占位**;设计师点击进入 focus 时激活 live,退出 focus 回到截图占位。非激活 surface 在画布 zoom 下保持位图,规避 iframe 被 CSS transform 缩放失真。多个 live iframe 并存(完整 browsing context + dev server 开销)是明确不做的形态。

单 surface 默认规则(2026-08-07 补,实现于 `prototype-surface-live-policy.ts`):**画布上恰有一个 ready surface 且无 focus 时,它默认 live**——单 surface 场景没有"谁该 live"的歧义,默认 live 省去仪式性点击;一旦存在第二个 ready surface,回到纯 focus-only。**设计师主动退出(选中后取消选中)唯一 surface 后,自动 live 在本次会话内不再复活**,直到设计师重新选中它;退出标志只在内存中,不持久化。

Focus Mode 扩展:focus 一个 Prototype Surface 即打开其 live preview;设计师需要标注时使用 Agent 宿主自带的浏览器标注能力,标注结论经 Issue 27 通道声明落库(DOM selector 等可作 opaque context)。

**明确不做**(相对被取代的 Issue 10/11):

- 不做 created page 的 hover 交互——Focus Mode + 宿主浏览器标注已覆盖其用途。
- 不做 Runtime 侧 DOM inspection:不实现 preview proxy 脚本注入、postMessage 取 DOM candidates、DOM↔canvas 坐标映射。原 Issue 11 的兜底语义("DOM inspection 失败时 annotation 仍有效")直接成为主路径:标注结论携带的 DOM context 一律 opaque,Runtime 不校验、不映射。
- 不做多个 surface 同时 live。

Stale 语义:preview dev server 退出、prototype code 变更后,surface 标记 stale 并提示设计师(复用 Figma evidence 的 stale warning 语义),不自动重启或删除。

## User stories covered

- 33, 34, 35, 36, 37, 38

## Acceptance criteria

- [ ] Agent 可声明 prototype code artifact;Runtime 启动或检测本地 dev server,记录 preview readiness(installing/starting/ready/failed)。
- [ ] `record_preview` 创建或更新 prototype run 与 Prototype Evidence Surface;run 记录 Seed Reference ids / evidence versions 与 design-system version。
- [ ] 每个 surface 显式声明 `routePath`;`sourceArtifactPath` 只作 provenance,
      Runtime 不猜测框架路由。iframe、打开按钮、readiness probe 与截图都访问
      `preview origin + routePath`。
- [ ] Workbench 在 tldraw 中以自定义 shape 显示 Prototype Surface,画布可共存多个。
- [ ] 仅 focus 的 surface 渲染 live iframe,其余渲染截图占位;focus 切换时 live/占位互换。
- [ ] preview started / preview failed 事件被记录。
- [ ] preview 失效(dev server 退出、code 变更)时 surface 标记 stale 并提示。
- [ ] 无 created page hover 交互;无 Runtime DOM inspection 相关代码路径。
- [ ] 测试覆盖:ready、failed、多 surface 共存、focus 切换 live/占位、stale 标记。

## Real Agent validation

- [ ] 真实 Agent 在真实项目文件夹中创建最小 Next.js/TypeScript/Tailwind/npm prototype 并声明 source artifacts 与 preview。
- [ ] Workbench 显示 surface,focus 后 live iframe 可交互;开第二个 surface 后前者回到截图占位。
- [ ] 设计师在 focus 中用宿主浏览器标注,Agent 将结论声明为 feedback 记录(Issue 27)。

## Likely difficulties for Agent

- Agent 把 dev server supervision 揽给自己,而不是交给 Runtime。
- 本地端口冲突、npm install 慢、依赖失败导致 preview readiness 不稳定。
- 多 surface 同时渲染 live iframe,内存/进程开销失控;或 zoom 时 iframe 内容缩放失真。
- iframe 吞掉画布平移/缩放手势(pointer events 穿透)。

## Suggested ways through

- Runtime 负责 dev server lifecycle,Agent 只写 code 和声明 artifact。
- 自定义 shape 基于 `BaseBoxShapeUtil` + HTMLContainer;非激活态渲染截图占位,激活态才挂 iframe;复用 `seed-evidence-workbench.css` 的 pointer-events 选择性放开模式与 tldraw `tl-stop-scroll-and-zoom` 先例。
- preview 状态显式展示 installing/starting/ready/failed。
- 先交付单 surface 的 focus-live 链路,再多 surface 共存。

## Blocked by

- `08-source-artifact-declaration-validation.md`
- `27-chat-first-designer-feedback-declaration.md`(标注结论落库通道)
- `28-phase-state-machine-design-system-formalization.md`(相位门:draft 未 confirm 不得 record 第一个 prototype)

## Notes

- 2026-08-07（下午，Prototype Surface frame 修复一轮，真实画布端到端核验通过）:
  - **缩放渲染**:live iframe 不再按真实尺寸撑大——始终使用与截图相同的固定 presentation viewport 渲染，再按 frame body 实测宽度 CSS `transform: scale()` 装入(ResizeObserver 测量，未测量时隐藏防闪烁)。即使 frame 宽于 presentation viewport 也不改变 iframe source width，避免重新触发响应式断点。`prototypeSurfaceLiveViewport()` 纯函数 + 单测。
  - **截图占位落地**:migration v29 给 `prototype_surfaces` 加 `screenshot_artifact_path` / `screenshot_captured_at`;preview ready 时 Runtime fire-and-forget 用 Playwright 截 fullPage 位图(固定 presentation viewport,`waitUntil:"load"` + 1.5s settle,存 `.ikran/artifacts/prototype-media/`,全失败静默)。非 live surface 显示该位图(经 `/api/artifacts`)+ 底部 hint 丸,替代纯文字占位。
  - **交互修复**:iframe 常驻可交互(不选中也能点页面,用户明确要求);选中/拖拽由 header chrome 承担。header 右上角按钮改为直接在浏览器新标签打开 preview URL(`window.open`)。
  - **视觉对齐 Figma 729:1640**:白色 1px 外描边 + 双阴影、header 20px 高无分割线、标题 10px、20×20 图标按钮、body 1px `#c7c7c7` 描边 + 4px 圆角、选中态 2px `#7a7a7a` 环。
  - 注意:此版本 tldraw **没有** `tl-stop-scroll-and-zoom` 类(上方"Suggested ways through"的先例已过时),iframe 天然吞 wheel/点击,无需额外处理。
- 2026-08-07: 新增 `get_prototype_rebuild_context` MCP 工具支撑 prototype_validation 阶段的 seed 重建回路:返回各 Seed Reference 的 source 身份(fileKey/nodeId/figmaLink)、current evidence surface id、design-system version 与 rebuild contract,并要求随后以返回的 seedReferenceIds / surface ids 作为 evidenceVersionIds 调用 `record_preview`。相位门外拒绝 `phase_gate`,无 Seed 拒绝 `no_seed_reference`;evidence capture 未完成的 seed 返回 `currentEvidence: null`。
- 2026-08-08（真实 Agent 回归修复）:Prototype screenshot 改为每个 surface
  一个稳定文件名并原子替换;成功写入新图后清理旧时间戳文件,DB 始终只指向
  一张有效截图。`screenshot_captured_at` 加入 artifact URL 作为 cache-bust。
  surface 因 `code_changed` stale、starting 或 failed 时仍显示最后一张有效
  截图并叠加状态提示;只有从未成功截图过才显示纯 unavailable placard。
  code-backed component hero 不再触发 Prototype screenshot。
- 2026-08-08（多页面与截图稳定性修订）:`record_preview` 新增显式
  `routePath`(`/`、`/projects/atlas` 等),DB 将 dev-server origin 与 page route
  分开保存;Prototype frame、打开按钮、probe、restore 和 screenshot 统一使用
  合成后的 surface URL。禁止从 `sourceArtifactPath` 猜 Next/Vite 路由。
  截图与 live iframe 统一使用 1133px fixed presentation viewport;不再由每个
  Workbench tab 的 `window.innerWidth` 改写全局唯一图片,避免多标签页在
  1133/1270 等宽度之间相互覆盖、导致非 live frame 持续缩放抽搐。二者使用
  同一 source viewport，保证切换 live/截图时响应式断点、max-width 居中边距
  和内容几何一致。
