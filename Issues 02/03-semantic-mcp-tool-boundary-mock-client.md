# Semantic MCP Tool Boundary 与 Mock Client

## What to build

建立 MVP 最小语义 MCP tool boundary。先实现可测的 tool handlers 和 mock MCP client，用来证明 Agent 可以通过语义 intent 改变 Runtime-owned records，而不是通过 raw exec、headless CLI adapter 或 canvas geometry 直接改状态。

此 slice 至少覆盖 `open_workbench`、`create_or_open_project`、`register_seed_reference`，并为后续 `record_evidence_package`、`create_region_annotation`、`record_artifact_written` 等工具保留统一 handler 形状。

## User stories covered

- 51, 53, 56, 57, 64, 65

## Acceptance criteria

- [x] 最小 MCP tool handler 边界可以被 mock MCP client 调用。
- [x] `open_workbench` 返回当前 Workbench URL。
- [x] `create_or_open_project` 绑定或恢复当前 project/session。
- [x] `register_seed_reference` 只记录 seed URL 和 original design intent，不访问 Figma。
- [x] Tool payload 失败时返回结构化错误，不写半成品 records。
- [x] 无 raw exec tool，无单独 geometry tool。
- [x] 测试覆盖成功、validation failure、project/session mismatch。

## Real Agent validation

- [x] Cursor 能发现最小 Ikran MCP tools，并至少调用 `open_workbench`。（实测：Cursor 发现并调用了 `register_seed_reference`，URL 原样存储 + event_id；`create_or_open_project` 对不同项目返回 `project_mismatch`。）
- [ ] Codex Desktop 尝试 tool discovery；若受 MCP tool 暴露 bug 影响，记录 fallback。（未测——open gap；fallback 见 `docs/manual-agent-smoke-issue03.md` 第 7 节。）

## Likely difficulties for Agent

- MCP server 的 stdio 生命周期和 Next.js dev server 生命周期可能不一致。
- 真实 Agent 可能倾向直接编辑文件或调用 shell，而不是使用 Ikran tools。
- Tool schema 过宽会导致后续 Runtime 难以校验语义 intent。

## Suggested ways through

- 先把 tool handlers 设计成可由 HTTP/test harness 直接调用的纯函数边界，再接 MCP transport。
- 在 tool descriptions 中明确“所有研究事实源变更必须通过 Ikran tools”。
- Schema 从最小字段开始，后续 issue 扩展，不预留过度泛化 payload。

## Blocked by

- `01-runtime-workbench-url-session-shell.md`
- `02-project-session-binding-ikran-metadata.md`

---

## 实现技术报告

**结论：Issue 02/03 完成。** Agent 通过语义 MCP tool `register_seed_reference` 写 Runtime-owned 研究事实源，而非 raw exec / headless CLI / canvas geometry。沿用两进程 + HTTP proxy + 纯 handler 模式（未做一进程整合）。

### 实现摘要

- 新增专用表 `seed_references`（当前事实源）+ event `seed_reference_registered`（审计日志）。未做通用 records 框架。
- `register_seed_reference` 只做**本地格式门**（https、`figma.com`/`www.figma.com`、`/design/<key>` 或 `/file/<key>`），**不访问 Figma**、不 fetch / oEmbed；原样保存 URL（不 normalize、不截断 `node-id`）。
- 无 active project 时 fail-closed 返回 `no_active_project`；无 token 返回 403；校验失败返回结构化错误、不写 record / event。

### 事实源 vs 审计（已接受取舍，不事务化）

`seed_references` = 事实源（先写并提交）；`seed_reference_registered` event = best-effort 审计。**audit 写失败不拖垮调用**：`logEvent` 被 try/catch 包住，失败时返回 `ok:true` + `event_id:null` + `audit_warning:"event_write_failed"`，调用方收到成功 → 不重试 → 不产生重复 record。「有 event 无 record」不可能（event 仅在 record 成功后写）。

### 旧路径保留

未清理 `seed_evidence_import` task-runner / mock adapter / `/api/figma/validate`（oEmbed 真验真那条旧 UI 路径）。新 `seed_references` 记录与旧 UI Enter Panel 不相连；新 UI（tldraw shell）+ Agent Figma 验真是后续 Issue 02/04 / 02/05。

### 文件

| 文件 | 说明 |
|---|---|
| `lib/runtime/seed-reference.ts` | handler：`validateSeedReferenceInput` + `registerSeedReference`（best-effort audit） |
| `lib/runtime/db.ts` | `seed_references` 表 + 索引 |
| `lib/runtime/events.ts` | `seed_reference_registered` event type |
| `app/api/seed-reference/route.ts` | HTTP route（authorize → active project → handler → 200/400） |
| `bin/ikran-mcp.mjs` | `register_seed_reference` tool（复用 ensureRuntime/apiPost；404→`route_not_found` 双路径诊断） |
| `tests/seed-reference-mcp.spec.ts` | 3 个 e2e（stdio MCP → 真实 HTTP route） |
| `tests/seed-reference-unit.spec.ts` | 2 个单元（happy + audit 写失败不重试） |
| `docs/manual-agent-smoke-issue03.md` | 真实 Agent smoke setup + 引导 |

### 验证

- `npm run typecheck` ✅
- `npx playwright test tests/seed-reference-unit.spec.ts` → 2 passed ✅
- `npx playwright test tests/seed-reference-mcp.spec.ts tests/open-workbench-mcp.spec.ts tests/project-session-mcp.spec.ts` → 9 passed ✅
- 真实 Cursor smoke 已对账：`ikran test 5/.ikran` 的 `events.jsonl` + SQLite 均有记录，URL 原样，event_id 一致；`create_or_open_project` 对不同项目 `project_mismatch`。

### 已知 open gap / 剩余风险

- **Codex Desktop tool discovery 未测**（issue 允许 fallback；见 smoke doc 第 7 节）。
- **`--prod` stale-build 404 仅诊断、不预防**：若 MCP host 复用旧 `.next` 构建，`register_seed_reference` 返回 `route_not_found` 并提示「build + 重启 MCP host/Runtime，或改 dev 模式」。代码层未做 BUILD_ID 失效（属 02/01 复用/启动架构，本 slice 不动）；合并闸门见 smoke doc 第 0 节。
- **新 UI「+ → 加真链接 → Agent 确认」闭环未成**：横跨 Issue 02/04（tldraw shell）+ 02/05（Agent-Host Figma Evidence Declaration）。本 slice 只完成「Agent 通过语义 tool 写 seed 记录 + 本地格式门」。
