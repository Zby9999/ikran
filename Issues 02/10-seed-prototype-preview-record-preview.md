# Seed Prototype Preview 与 `record_preview`

## What to build

让 Agent 创建或更新 seed reconstruction prototype，并通过 `record_artifact_written` 声明 prototype code。Runtime 管理本地 dev server readiness、稳定 preview URL、`record_preview` 和 Prototype Evidence Surface。Workbench 将 preview URL 嵌入 live iframe，并提供 focus mode。

此 slice 要证明 Ikran 使用真实交互 preview，而不是截图历史。

## User stories covered

- 33, 34, 35, 36

## Acceptance criteria

- [ ] Agent 可声明 prototype code artifact。
- [ ] Runtime 启动或检测本地 dev server，并记录 preview readiness。
- [ ] `record_preview` 创建或更新 prototype run 与 Prototype Evidence Surface。
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
