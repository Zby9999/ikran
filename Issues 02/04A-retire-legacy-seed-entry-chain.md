# Retire Legacy Seed Entry Chain

## What to build

在 `04-tldraw-workbench-shell-seed-entry.md` 完成后，清理不再被新版 tldraw Workbench 使用的旧 React Flow seed entry 链路，避免项目同时保留两套 seed entry 事实源路径。

此 slice 的目标是退役旧 UI/task/mock 入口，而不是实现下一阶段真实 Figma evidence ingestion。`record_evidence_package`、Figma Evidence Surface record、Region Annotation、Question Card 仍属于后续 issue。

## User stories covered

- 5, 6, 9, 54, 55

## Acceptance criteria

- [ ] Workbench 不再 import 或渲染 React Flow seed evidence surface。
- [ ] `useSeedEvidenceTask` / `seed_evidence_import` 不再被 Workbench seed entry 调用。
- [ ] 旧 React Flow seed entry 测试已删除或迁移为 tldraw + `seed_references` 测试。
- [ ] 旧 mock seed evidence package 代码没有被新版 seed entry 路径引用。
- [ ] Runtime source-of-truth 仍是 `seed_references` 专用表和语义事件。
- [ ] 删除清理不会影响 `register_seed_reference`、project/session binding、Workbench URL/session。
- [ ] 如果 `/api/figma/validate` 仍保留给 05 之前的兼容/排查，必须明确标注为 legacy unused by Workbench；如果删除，则 05 中对应退役验收同步调整。

## Real Agent validation

- [ ] 真实 Agent 调用 `register_seed_reference` 登记一个真实 Figma link。
- [ ] Workbench 只通过 tldraw projection 显示 seed reference，不触发旧 `seed_evidence_import`。
- [ ] Agent 不需要直接操作画布，也不需要调用旧 task family。

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
