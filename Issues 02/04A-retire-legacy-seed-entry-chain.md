# Retire Legacy Seed Entry Chain

## What to build

在 `04-tldraw-workbench-shell-seed-entry.md` 完成后，清理不再被新版 tldraw Workbench 使用的旧 React Flow seed entry 链路，避免项目同时保留两套 seed entry 事实源路径。

此 slice 的目标是退役旧 UI/task/mock 入口，而不是实现下一阶段真实 Figma evidence ingestion。`record_evidence_package`、Figma Evidence Surface record、Region Annotation、Question Card 仍属于后续 issue。

### 2026-07-10 后续架构收口

本 issue 完成报告中「保留通用 `/api/tasks`、task-runner、mock/cli adapter」等过渡表述已被当前标准替代。当前 Active 契约：无 AgentAdapter / `/api/tasks` / fake Agent connection / mock product families 产品路径；Seed 纯 Agent-first；一进程 + direct command kernel。下文实现技术报告保留为历史原文。

## User stories covered

- 5, 6, 54, 55

## Acceptance criteria

- [x] Workbench 不再 import 或渲染 React Flow seed evidence surface。
- [x] `useSeedEvidenceTask` / `seed_evidence_import` 不再被 Workbench seed entry 调用。
- [x] 旧 React Flow seed entry 测试已删除或迁移为 tldraw + `seed_references` 测试。
- [x] 旧 mock seed evidence package 代码没有被新版 seed entry 路径引用。
- [x] Runtime source-of-truth 仍是 `seed_references` 专用表和语义事件。
- [x] 删除清理不会影响 `register_seed_reference`、project/session binding、Workbench URL/session。
- [x] `/api/figma/validate` 已删除（与 Issue 05「Runtime 不再调用 Figma oEmbed」对齐，避免重复退役）。

## Real Agent validation

- [x] 真实 Agent 调用 `register_seed_reference` 登记一个真实 Figma link。（在 Issue 02/04 签收时已完成；本 slice 未改写路径。）
- [x] Workbench 只通过 tldraw projection 显示 seed reference，不触发旧 `seed_evidence_import`。
- [x] Agent 不需要直接操作画布，也不需要调用旧 task family。

## Likely difficulties for Agent

- 旧链路横跨 UI、task API、adapter mock、schema、测试；一次删除容易误删后续 issue 仍需要的 schema 或 event 基础设施。
- `05-agent-host-figma-evidence-declaration.md` 已计划引入 `record_evidence_package`，不要把 04A 做成 05 的提前实现。
- `/api/figma/validate` 的归属容易混淆：04 新路径不应调用它，但是否删除要和 05 的退役计划保持一致。
- 测试文件中有大量 React Flow 专属断言，不能简单保留成空测试或只改选择器。

## Suggested ways through

- 先用 `rg "seed_evidence_import|useSeedEvidenceTask|figmaEvidenceSurface|figma/validate|seedEvidencePackage|ReactFlow|react-flow"` 列清依赖。
- 从 Workbench 入口开始删引用，确认新版 tldraw path 只依赖 `POST/GET /api/seed-reference`。
- 删除或迁移旧 React Flow UI 测试，新增断言：不会调用 `/api/tasks`，不会生成 `seed_evidence_import_started`。
- 保留后续 evidence package 所需的通用 runtime 设施；只删除确认为 legacy seed entry 的代码。
- 如果决定删除 `/api/figma/validate`，同步更新 05 的 acceptance，避免重复退役项。

## Blocked by

- `03-semantic-mcp-tool-boundary-mock-client.md`
- `04-tldraw-workbench-shell-seed-entry.md`

---

## 实现技术报告（Issue 02/04A 完成）

**结论：Issue 02/04A 完成。** 旧 React Flow seed entry 链路已退役；Workbench 只保留 tldraw + `seed_references` 路径。未实现 `record_evidence_package` / Evidence Surface（留给 05）。

### 删除

| 项 | 说明 |
|---|---|
| `figma-evidence-surface-node.tsx` / `use-seed-evidence-task.ts` | 孤儿 React Flow UI |
| `@xyflow/react` + layout CSS import | 画布依赖 |
| `app/api/figma/validate` + `figma-reference.ts` | Runtime oEmbed 验真 |
| `seed_evidence_import` family / mock 分支 / seed-evidence-types | 旧 task 入口 |
| `dev-real-seed` / real-seed wrapper / agent-profiles / real-agent-smoke seed recorder | 旧 CLI seed smoke |
| `tests/real-agent-seed-evidence-smoke-record.spec.ts` | 旧 smoke 测试 |

### 保留（给后续 issue）

通用 `/api/tasks`、task-runner、mock/cli adapter（非 seed family）、`seed_references` + `register_seed_reference`、tldraw Workbench shell。

### Issue 05 同步

`/api/figma/validate` 已在本 slice 删除；05 的「Runtime 不再调用 Figma oEmbed」验收项记为已由 04A 完成。
