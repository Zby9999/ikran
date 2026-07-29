# Draft Design System 与 Derived View JSON

## What to build

在六部分 Design Intent Alignment 完成后，Agent 写入 design-system source artifacts，并通过 `record_artifact_written` 声明。Runtime 校验 source artifacts，生成或登记 derived `design-system-view.json`，Workbench 渲染 Foundations 和 Components 的 read-first 浏览器。

此 slice 应覆盖 Design principle、Visual language、Token、Layout、Component、Interaction 六部分如何进入 design-system candidate/source，而不引入 Content 必答门。

### 2026-07-12 Seed Reference collection input

Design-system source 必须链接到完成 Alignment 的 Seed Reference collection、项目级 Design Language Description、相关 Reference Notes 与 evidence versions，不能继续假设只有一个 seed page。详见当前 PRD 与 ADR 0003。

## User stories covered

- 23, 24, 25, 26, 27, 28, 29, 30, 31, 32

## Acceptance criteria

- [x] Agent 可声明 design-system candidate/source artifacts。
- [x] Runtime 校验 `token.json` 等结构化 artifact。
- [x] Runtime 生成或登记 derived `design-system-view.json`。
- [x] Workbench 渲染 Foundations：Color、Typography、Materials、Layout、Interaction。
- [x] Workbench 渲染 Components inventory 和 component detail。
- [x] 不创建独立 Rules 页面。
- [x] Design-system browser 以阅读为先，不提供复杂手动编辑器。
- [x] 测试覆盖 source declaration、derived view rendering、missing/invalid view JSON。

## Real Agent validation

- [x] 真实 Agent 基于至少两个 Runtime-captured Seed References、项目级 Description 和已回答 alignment questions 写入最小 design-system source artifact。
- [x] Agent 声明 artifact 后，Workbench 显示至少一个 foundation 和一个 component summary。

### 验证记录（2026-07-29，真实项目 `~/Desktop/ikran test 7`，schema v16）

- Agent 基于 1 个 Runtime-captured Seed Reference（Desktop frame，evidence version d60dd6f9）+ 项目级设计语言描述 + 18 张已答 alignment 卡（含 2 张 designer-edited）+ 6 条 Agent 注解，写入 6 个 JSON 源文件并声明。
- `GET /api/design-system`（DB 实时 join 证据链）返回完整 view：每条 entry 带 question_cards + evidence_versions + designer_annotations 证据链；derived export `.ikran/artifacts/design-system-view.json` 每次 ingest 自动重生成（`design_system_view_generated` ×7）。
- Workbench Browser 渲染核对（WebBridge 截图）：Foundations Home（visual language + principles + 状态汇总 3 formalized / 7 candidate / 3 open gaps）、Color / Materials（token 三层投影）、Layout / Interaction（rules）、Components inventory（Button / Project Card / Navigation）+ Button spec 详情（props / Boundaries / stateMatrix）。无独立 Rules 页面。

## Likely difficulties for Agent

- Agent 可能把 alignment candidate 直接当 formal design-system rules，缺少 designer answer 支撑。
- `design-system-view.json` 可能与 Markdown source 不一致。
- Token draft 与正式 `token.json` 的边界容易混淆。

## Suggested ways through

- Artifact declaration 要求关联 answered Question card ids。
- Runtime 将 `design-system-view.json` 视为 derived artifact；source artifact 仍是事实源。
- 对 `token.json` 做最小 schema 校验，先覆盖 colors/typography/spacing/radius 等核心类别。

## Blocked by

- `08-source-artifact-declaration-validation.md`
