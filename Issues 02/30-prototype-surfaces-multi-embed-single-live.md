# 30 — Prototype Surface 多嵌单活(Multi-Embed, Single-Live)

Status: implemented（Runtime + Figma 限定 UI；多嵌单活 focus 完整形态未做，画布仅 single-live）

## What to build

让 Agent 创建或更新 prototype code 并声明 source artifact;Runtime 管理本地 dev server lifecycle(installing / starting / ready / failed,不用模糊 loading)、稳定 preview URL 与 `record_preview`,创建 Prototype Evidence Surface。Seed reconstruction prototype 的 run metadata 必须记录使用的 Seed Reference ids / evidence versions 与 design-system version(沿用原 Issue 10 的 2026-07-12 收口)。

画布形态:**多嵌单活**——tldraw 画布可共存多个 Prototype Surface(自定义 shape,HTMLContainer + iframe,复用 `workbench-embeds.ts` 预留的 embed 意图),但**只有被 focus 的 surface 是 live iframe,其余显示截图占位**;设计师点击进入 focus 时激活 live,退出 focus 回到截图占位。非激活 surface 在画布 zoom 下保持位图,规避 iframe 被 CSS transform 缩放失真。多个 live iframe 并存(完整 browsing context + dev server 开销)是明确不做的形态。

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

- 2026-08-07: 新增 `get_prototype_rebuild_context` MCP 工具支撑 prototype_validation 阶段的 seed 重建回路:返回各 Seed Reference 的 source 身份(fileKey/nodeId/figmaLink)、current evidence surface id、design-system version 与 rebuild contract,并要求随后以返回的 seedReferenceIds / surface ids 作为 evidenceVersionIds 调用 `record_preview`。相位门外拒绝 `phase_gate`,无 Seed 拒绝 `no_seed_reference`;evidence capture 未完成的 seed 返回 `currentEvidence: null`。
