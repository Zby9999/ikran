# Seed Prototype Preview 与 `record_preview`

> **Status: superseded(2026-08-06)** — 由 `30-prototype-surfaces-multi-embed-single-live.md` 取代。原文保留供考古,以实现为准见 Issue 30。
>
> 取代记录:`record_preview`、dev server lifecycle、Prototype Evidence Surface、run metadata 记录等核心内容被 Issue 30 继承。变化:画布形态定为"多嵌单活"(仅 focus 的 surface 为 live iframe,其余截图占位);明确不做 created page hover;Focus Mode 扩展为打开 live preview;标注走宿主浏览器 + Issue 27 声明通道,不再规划 Runtime 侧 DOM inspection(原后续 Issue 11 一并放弃)。

## What to build

让 Agent 创建或更新 seed reconstruction prototype，并通过 `record_artifact_written` 声明 prototype code。Runtime 管理本地 dev server readiness、稳定 preview URL、`record_preview` 和 Prototype Evidence Surface。Workbench 将 preview URL 嵌入 live iframe，并提供 focus mode。

此 slice 要证明 Ikran 使用真实交互 preview，而不是截图历史。

### 2026-07-12 Seed collection reconstruction

Seed reconstruction prototype 应消费已经完成 Alignment 的 Seed Reference collection 与 design-system source；如果多个 References 表达不同页面/组件，prototype run metadata 必须记录使用了哪些 Reference/evidence versions，不能只链接一个隐式 seed。详见当前 PRD 与 ADR 0003。

## User stories covered

- 33, 34, 35, 36

## Acceptance criteria

- [ ] Agent 可声明 prototype code artifact。
- [ ] Runtime 启动或检测本地 dev server，并记录 preview readiness。
- [ ] `record_preview` 创建或更新 prototype run 与 Prototype Evidence Surface。
- [ ] Seed reconstruction prototype run 记录所使用的 Seed Reference ids / evidence versions 与 design-system version。
- [ ] Workbench 在 tldraw 中显示 Prototype Evidence Surface。
- [ ] Prototype Evidence Surface 使用 live iframe preview。
- [ ] Focus mode 能打开 preview URL。
- [ ] preview started / preview failed 事件被记录。
- [ ] 测试覆盖 ready、failed、iframe URL、focus mode。

## Real Agent validation

- [ ] 真实 Agent 在真实项目文件夹中创建最小 Next.js/TypeScript/Tailwind/npm prototype。
- [ ] Agent 声明 source artifacts 和 preview。
- [ ] Workbench 显示 live iframe，手动确认可交互。

## Likely difficulties for Agent

- Agent 可能把 dev server supervision 交给自己，而不是 Runtime。
- 本地端口冲突、npm install 慢、依赖失败会让 preview readiness 不稳定。
- iframe sandbox 和 localhost origin 可能阻止交互或 DOM inspection。

## Suggested ways through

- Runtime 负责 dev server lifecycle，Agent 只负责写 code 和声明 artifact。
- preview 状态要显示 installing/starting/ready/failed，不用模糊 loading。
- 先验证 live iframe 可用，再进入 DOM inspection issue。

## Blocked by

- `08-source-artifact-declaration-validation.md`
- `09-draft-design-system-derived-view.md`
