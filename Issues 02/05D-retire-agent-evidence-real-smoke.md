# 05D — 退役 Agent-Supplied Evidence 与真实转型 Smoke

**Status:** ready-for-human

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
- [x] deterministic one-process vertical test 完整覆盖：connect → paste → capture → second Reference → Agent add → duplicate reuse → annotation candidates → explicit Refresh。（真实 Workbench clipboard handler + HTTP + MCP + SSE，同一个 MCP-owned Runtime。）
- [x] HTTP/MCP command parity、no-loopback、SQLite transaction、SSE projection 和 no-secret guards 在新路径上保持通过。（含 Refresh 后 `evidence/created` + `seed/updated` commit-only projection。）
- [x] 删除/替换旧路径后运行项目 `npm run check`；任何仍保留的 legacy reader 必须有明确历史兼容测试，不能重新成为写入口。
- [x] PRD、CONTEXT、ADR、Issue 05/06–16、manual smoke 文档和 MCP descriptions 使用同一 Active 术语与工具面。

## Acceptance criteria — real end-to-end smoke

- [x] 使用真实 PAT 打开 Figma Connection Gate，重启 Runtime 后仍连接；报告不包含 secret。（Browser Use 受控重启后 Connection Gate 仍为 `open`，两个既有 Surface 继续投影；核验过程未读取或输出 PAT。）
- [x] 设计师在无 Agent 参与时粘贴至少两个真实 Figma nodes，均得到可视 Surface；重复 link 不重复创建。（Browser Use 实机复验：Workbench 保持 2 个可视 Surface；粘贴 canonical-equivalent link 后仍为 2 个 current Seed References，Surface id 未变化。）
- [ ] 真实 Agent 通过新 MCP tool 添加另一个 node，并在 Workbench 中通过 SSE 出现。
- [ ] 设计师创建真实 Figma Region Annotation；Runtime 返回 candidates；Agent 通过宿主 Figma MCP 获取 implementation context 并确认 primary node。
- [x] 显式 Refresh 生成新 current evidence version，历史 Surface 与 annotation 仍可回放。（真实节点 `260:3308` 在修复 proxy-aware transport 后约 4.46 秒完成；旧 Surface 与锚定旧 evidence version 的 Annotation records 保留，新截图已在 Workbench 投影。）
- [x] smoke 报告逐项标记 automated pass、real pass、blocked、not attempted；不得用 deterministic adapter 结果替代真实 Figma API、真实 Keychain 或真实 Agent host 结果。

## Blocked by

- Automated scope 无 blocker；剩余两项 real smoke 需要真实 Agent host。安装级 PAT 重启持久化与真实 Figma Refresh 已通过。

## Comments

### 2026-07-12 — concurrent with 05A (human-requested)

- 与 05A 工作区同树推进：Active MCP/HTTP 退役 Agent-supplied evidence 写入口（含 `POST /api/evidence-package` → `410 endpoint_retired`、MCP instructions / `pending-directive` 清理）为产品方单独要求，不是 05A 范围膨胀。Seed Reference 删除能力同属单独要求，实现落在 Runtime/Workbench，不计入本 issue 的 remaining AC。
- **Shipped (partial):** 上表已勾选的 Active MCP/HTTP 退役项已随 05A follow-up 提交推送到 `main`；其余 automated / real smoke AC 仍待继续。

## Completion report — 2026-07-14

已完成 10/10 项 automated AC：Active MCP/HTTP/Workbench 已统一到 Runtime-owned capture；pending reader 与 Agent-supplied evidence writer 均保持 retired；历史 reader 仅作为明确兼容层保留。单进程纵切现在从真实 Workbench clipboard paste 开始，在同一个 MCP-owned Runtime 中贯穿第二 Reference、Agent MCP add、canonical duplicate reuse、annotation candidates、explicit Refresh、SQLite lineage、SSE 页面投影与 no-secret 检查；另有禁用 `global fetch` 的聚焦测试证明 MCP semantic write 不走 HTTP loopback。Refresh 提交后同时广播 `evidence/created` 与 `seed/updated`，明确投影 current Surface 变化。

验证：`npm run check` 完整通过（typecheck；53 unit files / 414 tests；64 e2e tests）。Inter 已改为附带 OFL 许可证的官方本地 variable font，保持现有字体设计并消除 Next build 对 Google Fonts 网络请求的依赖。Structure Overlay / annotation geometry 定向 suite 5 files / 30 tests 通过；Browser Use 继续作为真实 Workbench smoke 工具。Code review 的 Standards 轴发现的重复 SSE helper 已提取到 `tests/helpers/sse.ts` 并修复 timeout waiter 清理；Spec 轴指出的 clipboard-handler 缺口已由真实 paste vertical 补齐；复审前述 automated 缺口均已关闭。`git diff --check` 通过。

Real smoke 已完成 4/6 项。Browser Use 实机验证中，Annotation 模式下两个真实 Figma Surface 均可见；Structure Overlay 命中节点 `197:58`，hover highlight 使用与结构化 Annotation 一致的较小外扩 margin；粘贴 canonical-equivalent Figma link 后 current Seed Reference 数量和 Surface id 均未变化，因此重复复用项标记为 real pass。随后受控重启 Runtime，Workbench 的 Figma Connection Gate 仍为 `open`，两个既有 Surface 继续投影，证明真实 PAT 安装级持久化通过；核验过程未读取或输出 secret。

2026-07-15 follow-up：显式 Refresh 的 `figma_api_timeout` 已定位为 Node 全局 `fetch` 未读取标准 proxy env，导致 Figma signed S3 screenshot body 走不可用直连；Runtime Figma client 改为 Undici `EnvHttpProxyAgent` 后，不降低截图体积的真实节点 `260:3308` 在约 4.46 秒完成 Refresh。current Surface 从 `c9fde43b…` 前进至 `08ae2dd9…`，历史 Surface、lineage 与锚定旧 evidence version 的 Annotation records 保留，Workbench 显示更新后的 Redo frame。`npm run check` 完整通过（typecheck；53 unit files / 415 tests；64 e2e tests）。真实 Agent add/SSE 与真实 candidate→Figma MCP→primary confirmation 仍为 `not attempted`；deterministic adapter 结果没有计作 real pass。
