# Seed Figma Import 与 Evidence Surface 初始化

## What to build

加入 Start building 之后的 seed import workbench 路径。设计师完成 setup 后进入 React Flow 工作区，但在第一次 Figma seed import 完成前，画布保持严格 locked 状态：不能 pan、zoom 或编辑，只显示用于导入 seed page 的 Enter Panel。

设计师先输入 Figma seed reference，再输入一段简短 original design intent。Ikran Runtime 将这两项作为 seed evidence task payload 传给 AgentAdapter。mocked AgentAdapter 返回 deterministic seed evidence package，包括 Figma structured evidence 和 Figma Evidence Surface；Browser UI 将 Evidence Surface 渲染到 React Flow 工作区中，并在首次导入成功后解锁画布移动。

Issue 04 不包含设计师或 Agent 的 annotation 创建。annotation、question / assumption 标签、区域锚定 callout 和阶段化提问属于后续 seed alignment stage。

Issue 04 可以主要使用 mock path，但完成前必须至少尝试一次真实 external Agent 接入：通过已配置 Figma MCP 的 Agent 环境，对一个真实 Figma seed page 运行 seed evidence import smoke，并记录真实接入结果、失败原因或 open gaps。Runtime 不实现 Figma MCP；真实 Figma 摄取仍委托给外部 Agent 边界。

**Real Agent smoke (2026-07-06):** attempted via headless `agent` / `claude` CLI; **BLOCKED** — no schema-valid `seed_evidence_import` package from external CLI. Recorded in `.plans/issue04/REAL_AGENT_SMOKE.md` and `.plans/issue04/real_agent_seed_evidence_smoke.jsonl` (`real_agent_seed_evidence_smoke_recorded`).

## User stories covered

- 1
- 4
- 74

## Acceptance criteria

- [ ] Start building 后进入 seed-import locked React Flow 工作区；第一次 Figma seed import 完成前，用户不能 pan、zoom 或编辑画布。
- [ ] Browser UI 按 Figma 参考渲染 Enter Panel 的 Default、Enter Address、Enter Description、Loading 状态。
- [ ] 用户可以提交 Figma seed reference 和简短 original design intent description。
- [ ] Ikran Runtime 创建 seed evidence task，并把 Figma seed reference 与 original design intent 一起传给 AgentAdapter。
- [ ] mocked adapter 返回 deterministic evidence package，其中包含 Figma structured evidence 和 Figma Evidence Surface。
- [ ] 中心工作区在 React Flow 中渲染 Figma Evidence Surface；导入成功后才开放画布 pan/zoom。
- [ ] Issue 04 不创建 designer annotation、Agent annotation、question / assumption 标签、region selection 或 anchored callout。
- [ ] 首次 seed extraction 的设计系统抽取和 seed prototype 重建必须依赖 Figma structured evidence，而不是截图转代码。
- [ ] 至少一次真实 external Agent seed evidence import smoke 被手动尝试，输入真实 Figma seed reference 和 original design intent；结果、失败原因或 open gaps 被记录，不允许用 mock success 掩盖。
- [ ] 记录 `seed evidence import started`、`Figma evidence package returned` 和必要的真实 Agent smoke 结果事件。
- [ ] 测试验证 mocked evidence 和 seed intent 来自 Ikran Runtime 数据，而不是 UI hardcoded fixtures。

## Blocked by

- `02-project-folder-ikran-metadata.md`
- `03-mocked-agent-task-runner.md`
- `03a-real-agent-smoke-adapter.md`
