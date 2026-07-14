# 05D — 退役 Agent-Supplied Evidence 与真实转型 Smoke

**Status:** ready-for-agent

## What to build

完成 ADR 0003 的 contract 阶段：把 Active 产品路径、MCP instructions、测试 fixtures 和文档全部迁移到 Runtime-owned Figma positional-evidence capture，移除 `list_pending_seed_evidence` 与 Agent-supplied `record_evidence_package` 工具入口；保留历史成功 evidence 可读和可回放。最后复跑 deterministic one-process 纵切与真实 PAT/Figma/Agent handoff，证明转型不是只有 schema/mock 成功。

## User stories covered

- 64, 65, 76, 77, 78

## Acceptance criteria — automated

- [x] MCP tool discovery 不再暴露 `list_pending_seed_evidence`、`register_seed_reference` 或 Agent-supplied `record_evidence_package`；Active seed capture 入口为 `get_figma_connection_status` + `add_seed_reference`，其余 Refresh/context/candidates/correspondence tools 保持显式 supporting surface。
- [x] MCP instructions 不再要求 Agent 截图、轮询 pending seed 或声明 Figma evidence（与 Active 工具面一致）。（`IKRAN_MCP_INSTRUCTIONS` + `open_workbench` 已改为 Runtime capture / Connection Gate；`pending-directive` 已删除。）
- [x] Active HTTP/Workbench/MCP seed flow 全部走 shared Runtime capture command；不存在可绕过 Figma Connection Gate 写入新 Figma Surface 的产品 endpoint。（`POST /api/seed-reference` → `addSeedReferenceCommand`；`POST /api/evidence-package` → `410 endpoint_retired`；GET 仍可读历史 Surface。）
- [x] 生产源与 Active tests 不再依赖 awaiting-Agent screenshot orchestration、`registered_via` 分源 loading 或 Agent-provided screenshot payload。
- [x] 历史已完成 Seed Reference/Evidence Surface/annotation 数据仍可读取、投影和导出；迁移不重写历史 initiator/provenance。
- [x] 历史只有 pending reference、没有成功 evidence 的记录不被视为成功 positional evidence，不进入成功研究 export。
- [ ] deterministic one-process vertical test 完整覆盖：connect → paste → capture → second Reference → Agent add → duplicate reuse → annotation candidates → explicit Refresh。
- [ ] HTTP/MCP command parity、no-loopback、SQLite transaction、SSE projection 和 no-secret guards 在新路径上保持通过。
- [ ] 删除/替换旧路径后运行项目 `npm run check`；任何仍保留的 legacy reader 必须有明确历史兼容测试，不能重新成为写入口。
- [x] PRD、CONTEXT、ADR、Issue 05/06–16、manual smoke 文档和 MCP descriptions 使用同一 Active 术语与工具面。

## Acceptance criteria — real end-to-end smoke

- [ ] 使用真实 PAT 打开 Figma Connection Gate，重启 Runtime 后仍连接；报告不包含 secret。
- [ ] 设计师在无 Agent 参与时粘贴至少两个真实 Figma nodes，均得到可视 Surface；重复 link 不重复创建。
- [ ] 真实 Agent 通过新 MCP tool 添加另一个 node，并在 Workbench 中通过 SSE 出现。
- [ ] 设计师创建真实 Figma Region Annotation；Runtime 返回 candidates；Agent 通过宿主 Figma MCP 获取 implementation context 并确认 primary node。
- [ ] 显式 Refresh 生成新 current evidence version，历史 Surface 与 annotation 仍可回放。
- [ ] smoke 报告逐项标记 automated pass、real pass、blocked、not attempted；不得用 deterministic adapter 结果替代真实 Figma API、真实 Keychain 或真实 Agent host 结果。

## Blocked by

- `06-evidence-surface-region-annotation-slice.md`

## Comments

### 2026-07-12 — concurrent with 05A (human-requested)

- 与 05A 工作区同树推进：Active MCP/HTTP 退役 Agent-supplied evidence 写入口（含 `POST /api/evidence-package` → `410 endpoint_retired`、MCP instructions / `pending-directive` 清理）为产品方单独要求，不是 05A 范围膨胀。Seed Reference 删除能力同属单独要求，实现落在 Runtime/Workbench，不计入本 issue 的 remaining AC。
- **Shipped (partial):** 上表已勾选的 Active MCP/HTTP 退役项已随 05A follow-up 提交推送到 `main`；其余 automated / real smoke AC 仍待继续。

## Completion report — 2026-07-14

已完成 7/10 项 automated AC：Active MCP/HTTP/Workbench 已统一到 Runtime-owned capture；pending reader 与 Agent-supplied evidence writer 均返回/保持 retired；Workbench persisted projection 不再依据 `registered_via` 分流 loading；历史 reader 仅作为明确兼容层保留。新增 command-kernel integration 覆盖 connect、Workbench initiator capture、第二 Reference、Agent initiator add、canonical duplicate reuse、annotation candidates、explicit Refresh 与 PAT 不进入 response/SQLite/events；manual smoke 已改写为真实 PAT/Figma/Agent 转型流程。

验证：`npm run typecheck` 通过；完整 unit suite 53 files / 414 tests 通过；05D 定向 suite 8 files / 98 tests 通过；最新安全/SSE command-kernel 定向 suite 6 files / 53 tests 通过。`git diff --check` 通过。完整 one-process HTTP+MCP+SSE vertical、Playwright 与 `npm run check` 未勾选：本轮 Playwright global build 首次因沙箱无法获取 Google Fonts 失败，联网重跑审批通道随后异常中断，未以绕过方式冒充通过。

Real end-to-end smoke 全部保持未勾选：本轮未使用真实 PAT、真实 Figma nodes 或真实 Agent host，因此状态为 `not attempted`，deterministic adapter 结果没有计作 real pass。
