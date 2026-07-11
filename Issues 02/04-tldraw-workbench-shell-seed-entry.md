# tldraw Workbench Shell 替换 React Flow Seed Entry

## What to build

把当前 React Flow seed evidence workbench 迁移为 tldraw Workbench shell。用户在 Workbench 中输入 Figma seed reference 和 original design intent，Runtime 通过 MCP/HTTP 语义边界登记 seed reference，并在 tldraw 中投影一个初始 canvas record。

此 slice 不要求真实 Figma evidence package，也不创建 Region Annotation 或 Question card。目标是完成“seed entry -> Runtime record -> tldraw projection”的端到端纵切。

### 2026-07-10 后续架构收口

本 issue 历史实现含 **Workbench EnterPanel seed 写入口** 与两进程拓扑说明；这些已被当前标准替代。当前 Active 契约：**Seed 纯 Agent-first**（仅 `register_seed_reference`）；Workbench **无** seed URL / intent 写入口；一进程 Runtime；tldraw 仍只投影 Runtime records。下文实现技术报告保留为历史原文，勿当作当前双入口仍有效。

## User stories covered

- 5, 6, 9, 54, 55

## Acceptance criteria

- [x] Workbench 使用 tldraw 作为画布底座，不再依赖 React Flow seed surface。
- [x] 用户能提交 Figma seed reference 和 original design intent。
- [x] Runtime 创建 seed reference record，并记录语义事件。
- [x] tldraw shape 投影该 record，并携带 canvas record id。
- [x] tldraw geometry 不作为研究事实源持久化。
- [x] 测试验证刷新后 semantic record 仍在，geometry 可重建或丢失不影响事实源。

## Real Agent validation

- [x] 真实 Agent 调用 `register_seed_reference` 登记一个真实 Figma link。
- [x] Workbench 显示对应 tldraw projection；Agent 不需要直接操作画布。

## Likely difficulties for Agent

- 当前 Workbench 组件直接使用 React Flow，迁移时容易把旧 node/edge 状态当事实源保留。
- tldraw 本地 store 和 Runtime semantic records 的同步边界容易混淆。
- 没有最终 Figma 设计稿时，UI 改动可能违反项目设计规则。

## Suggested ways through

- 先做最小 tldraw shell，只投影一个 seed record，不实现复杂布局。
- 定义 record id 到 shape metadata 的单向投影，避免从 shape 反推语义。
- UI 细节沿用已有 Figma 参考；无参考的视觉变化只做最小可用。

## Blocked by

- `02-project-session-binding-ikran-metadata.md`
- `03-semantic-mcp-tool-boundary-mock-client.md`

---

## 实现技术报告（Issue 02/04 完成）

**结论：Issue 02/04 完成。** React Flow seed evidence workbench 迁移为 tldraw Workbench shell，打通「seed entry → Runtime `seed_references` 语义 record → tldraw 投影」端到端纵切。新路径完全不调用旧链路（`/api/tasks` / `seed_evidence_import` / mock-adapter seed evidence package / React Flow evidence surface / `/api/figma/validate`）；旧链路代码保留，退役留给 Issue 02/04A。

### 新 seed entry 数据流

```
EnterPanel(+ → 输入 Figma URL → 本地格式门 → description → 输入 intent → Enter Canvas)
  → useSeedReferences.register() → POST /api/seed-reference
  → seed_references record（事实源）+ seed_reference_registered 事件（审计）
  → hook GET 刷新 records → WorkbenchCanvas 单向投影 → tldraw shape 出现，EnterPanel 覆盖层消失
```

### 文件

| 文件 | 说明 |
|---|---|
| `components/workbench/seed-reference-projection-shape.tsx` | tldraw 自定义 shape（`BaseBoxShapeUtil` + `TLGlobalShapePropsMap` 增强），meta 带 record id |
| `components/workbench/workbench-canvas.tsx` | `<Tldraw hideUi>` 最小 canvas + records→shapes 单向对账 |
| `components/workbench/use-seed-references.ts` | 新 hook：GET 加载 / POST 注册 / 1.5s 轻量轮询 |
| `components/workbench/SeedEvidenceWorkbench.tsx` | 动态导入 tldraw（ssr:false）+ 复用 EnterPanel + 本地格式门 |
| `app/api/seed-reference/route.ts` | 新增 GET（authorize → active project → listSeedReferences → records） |
| `components/workbench/seed-evidence-workbench.css` | 新增 `.seed-workbench__canvas` |
| `tests/seed-evidence-workbench.spec.ts` | 重写为 tldraw + seed reference（6 用例） |
| `package.json` | `tldraw@^5.2.3`（React 19 兼容） |

### 关键边界

- **tldraw 是投影层**：shape `meta` = `{ canvasRecordId: "seed-reference:<id>", runtimeRecordId: id, kind: "seed_reference_projection" }`；shape id = `createShapeId(record.id)`（按 record.id 稳定）。DOM `data-runtime-record-id` / `data-canvas-record-id` 供测试与对账。
- **geometry 不是事实源**：默认 `<Tldraw>`（无 `persistenceKey`）store 纯内存，刷新即清空；`SeedProjectionSync` 只从 records 建/删 shape，从不回写 Runtime；刷新后由 GET 在默认位置重建（拖动位置仅当次会话保留）。测试证明 record 仍在、投影重建。
- **GET /api/seed-reference 新增**：刷新重建 + 轻量轮询接管 Agent 写入。无 active project 返回 `no_active_project`。
- **本地格式门**：address→description 用客户端 `looksLikeFigmaSeedReference`（镜像 Runtime 规则，不访问网络）；权威校验在 POST 时由 Runtime 做，失败回 `description` 可编辑态、不写 record。

### 旧链路（切断但未删除，留给 02/04A）

`use-seed-evidence-task.ts`、`figma-evidence-surface-node.tsx`、`app/api/figma/validate/route.ts`、`lib/runtime/seed-evidence-types.ts`、`seed_evidence_import` task family / mock adapter seed evidence 分支、React Flow CSS 规则。`rg` 审计：新 Workbench 路径对这些符号无代码引用（仅注释）。

### 验证

- `npm run typecheck` ✅
- `npx playwright test tests/seed-reference-mcp.spec.ts tests/seed-reference-unit.spec.ts` → 5 passed ✅
- `npx playwright test tests/seed-evidence-workbench.spec.ts` → 6 passed ✅
- `npm run check`（typecheck + 全量 e2e）→ 53 passed，0 failed ✅

### 真实 Agent smoke 结论

真实 Cursor 通过 MCP `register_seed_reference` 登记真实 Figma link（record 写入 `~/Desktop/ikran test 5/.ikran/ikran.db`，event id 一致）。Workbench 重启加载新构建后，`GET /api/seed-reference` 取到该 record，tldraw 投影自动出现，Agent 无需操作画布。

**踩坑（已解决）**：在跑的 `next start`（prod）Runtime 是旧构建、不热加载新 build——表现为 GET 返回 405、UI 仍是旧 React Flow「+」。重启 Runtime 加载新构建后即恢复。开发期建议用 `npm start`（dev）热加载。

### 已知 open gap / 剩余风险

- **两进程拓扑**：MCP 与 UI 仍为两进程 + HTTP proxy（沿用 02/03，未做一进程整合）。共享同一 `IKRAN_STATE_DIR` 时复用同一 Runtime / active project，record 可见；若 `setup_workspace` 给 `.cursor/mcp.json` 设了 per-project `IKRAN_STATE_DIR`，会与 launcher 的 Runtime 分裂，Agent 写入的 record 在 UI 不可见——需对齐 state dir。一进程整合留给后续 issue。
- 轻量轮询 1.5s；未做 event bus / SSE 推送（本 slice 明确不做复杂机制）。
- 旧链路退役、`record_evidence_package`、Figma 真验真、Region Annotation / Question Card 均属后续 issue。

---

## Follow-up：投影层 UI 收口（Figma Extraction / Frame）

主路径完成后的视觉跟进，不改 Runtime / MCP 边界。

- **左上角 Folder 面板**：EnterPanel 关闭后增加 Extraction 一栏（阶段/总进度 stub、Follow Agent / Annotate 按钮 stub）。
- **Figma seed Frame**：紫框 + 标题（缺省「Figma seed」）+ info tip；媒体区白底占位（真截图留给后续）；默认约 380×520；等比缩放。
- **选中 chrome**：隐藏 tldraw 蓝框与角点方块，保留四角等比缩放命中；隐藏旋转柄。
- **Stroke**：未选中外框 + 媒体框均为 `#B980B9`；选中加深为 `#731b73`。
