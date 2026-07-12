# 05D — 退役 Agent-Supplied Evidence 与真实转型 Smoke

**Status:** ready-for-agent

## What to build

完成 ADR 0003 的 contract 阶段：把 Active 产品路径、MCP instructions、测试 fixtures 和文档全部迁移到 Runtime-owned Figma positional-evidence capture，移除 `list_pending_seed_evidence` 与 Agent-supplied `record_evidence_package` 工具入口；保留历史成功 evidence 可读和可回放。最后复跑 deterministic one-process 纵切与真实 PAT/Figma/Agent handoff，证明转型不是只有 schema/mock 成功。

## User stories covered

- 64, 65, 76, 77, 78

## Acceptance criteria — automated

- [ ] MCP tool discovery 不再暴露 `list_pending_seed_evidence` 或 Agent-supplied `record_evidence_package`；instructions 不再要求 Agent 截图、轮询 pending seed 或声明 Figma evidence。
- [ ] Active HTTP/Workbench/MCP seed flow 全部走 shared Runtime capture command；不存在可绕过 Figma Connection Gate 写入新 Figma Surface 的产品 endpoint。
- [ ] 生产源与 Active tests 不再依赖 awaiting-Agent screenshot orchestration、`registered_via` 分源 loading 或 Agent-provided screenshot payload。
- [ ] 历史已完成 Seed Reference/Evidence Surface/annotation 数据仍可读取、投影和导出；迁移不重写历史 initiator/provenance。
- [ ] 历史只有 pending reference、没有成功 evidence 的记录不被视为成功 positional evidence，不进入成功研究 export。
- [ ] deterministic one-process vertical test 完整覆盖：connect → paste → capture → second Reference → Agent add → duplicate reuse → annotation candidates → explicit Refresh。
- [ ] HTTP/MCP command parity、no-loopback、SQLite transaction、SSE projection 和 no-secret guards 在新路径上保持通过。
- [ ] 删除/替换旧路径后运行项目 `npm run check`；任何仍保留的 legacy reader 必须有明确历史兼容测试，不能重新成为写入口。
- [ ] PRD、CONTEXT、ADR、Issue 05/06–16、manual smoke 文档和 MCP descriptions 使用同一 Active 术语与工具面。

## Acceptance criteria — real end-to-end smoke

- [ ] 使用真实 PAT 打开 Figma Connection Gate，重启 Runtime 后仍连接；报告不包含 secret。
- [ ] 设计师在无 Agent 参与时粘贴至少两个真实 Figma nodes，均得到可视 Surface；重复 link 不重复创建。
- [ ] 真实 Agent 通过新 MCP tool 添加另一个 node，并在 Workbench 中通过 SSE 出现。
- [ ] 设计师创建真实 Figma Region Annotation；Runtime 返回 candidates；Agent 通过宿主 Figma MCP 获取 implementation context 并确认 primary node。
- [ ] 显式 Refresh 生成新 current evidence version，历史 Surface 与 annotation 仍可回放。
- [ ] smoke 报告逐项标记 automated pass、real pass、blocked、not attempted；不得用 deterministic adapter 结果替代真实 Figma API、真实 Keychain 或真实 Agent host 结果。

## Blocked by

- `06-evidence-surface-region-annotation-slice.md`
