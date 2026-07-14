# Issue 02/05D — Runtime-owned Figma positional evidence 真实冒烟

> 这是当前 Active smoke 手册。旧 `register_seed_reference`、`list_pending_seed_evidence`、Agent-supplied `record_evidence_package` 与 awaiting-Agent screenshot 编排均已退役；历史读取兼容不代表这些入口仍可写。

## 目标

验证 ADR 0003 的真实边界：Ikran Runtime 使用安装级 Figma Connection 捕获 screenshot 与 positional index；Workbench paste 和 Agent `add_seed_reference` 共享同一 command；Agent 仅在需要 implementation context 时使用宿主 Figma MCP，并显式确认 annotation primary node。

Deterministic adapter、mock PAT、Playwright fixture 只能记作 automated pass，不能代替本手册的 real pass。

## 前置条件

1. 使用最新构建启动 Runtime；MCP host 与 Workbench 指向同一 `IKRAN_STATE_DIR`。
2. 准备只读真实 Figma PAT、至少三个可访问的 Figma selection links，以及可调用宿主 Figma MCP 的真实 Agent host。
3. 创建或绑定测试项目，并确认报告、终端与截图中不出现 PAT。

## 真实纵切

1. 在 Workbench Figma Connection Gate 连接真实 PAT；重启 Runtime，确认连接状态仍存在。
2. 不借助 Agent，在 Workbench 粘贴第一个 link。预期一次成功同时产生 Seed Reference 与可视 Evidence Surface，无 pending/awaiting-Agent 状态。
3. 粘贴第二个不同 node。预期得到独立 Reference/Surface；再次粘贴第一个 canonical-equivalent link，预期复用既有 Reference，不追加版本。
4. 让真实 Agent 调 `add_seed_reference` 添加第三个 node。预期 Runtime 自行 capture，并通过 SSE 出现在已打开的 Workbench。
5. 在 Annotation 模式创建 region annotation。预期 Runtime 返回确定性 candidates，但不自行写 primary node。
6. 让 Agent 根据 candidate 的 source identity 调宿主 Figma MCP 获取 implementation context，再调 `confirm_annotation_primary_node` 明确确认。
7. 对第一个 Reference 调 `refresh_seed_reference`。预期追加 current evidence version；旧 Surface、旧 annotation target 与 provenance 仍可读取/回放。
8. 重启 Runtime 后复查以上记录与 Figma Connection 状态。

## 退役边界检查

- MCP discovery 不应出现 `register_seed_reference`、`list_pending_seed_evidence`、`record_evidence_package`。
- `GET /api/pending-seed-evidence` 与 `POST /api/evidence-package` 应返回 `410 endpoint_retired`。
- Workbench 不应出现 “Waiting for Agent evidence capture” 或按 `registered_via` 分流的 loading。
- 任何 capture 失败都不得留下半写 Seed/Surface；duplicate 不得隐式 refresh。
- Runtime/MCP 响应、event、SQLite、日志和报告均不得包含 PAT。

## 失败分类

| 状态 | 说明 |
|---|---|
| `automated pass` | deterministic/unit/Playwright 证据通过，不代表真实 Figma 已验证 |
| `real pass` | 本手册使用真实 PAT、真实 Figma API 与真实 Agent host 通过 |
| `blocked` | 已尝试，但受权限、网络、host discovery 或真实数据限制 |
| `not attempted` | 本轮没有执行真实步骤 |

## 冒烟报告模板

```text
日期：
构建 / commit：
测试项目：

Automated：
- tool/endpoint retirement：pass / fail
- deterministic one-process vertical：pass / fail
- parity / no-loopback / transaction / SSE / no-secret：pass / fail
- npm run check：pass / fail / blocked（原因：____）

Real：
- PAT connect + restart persistence：real pass / blocked / not attempted
- two Workbench pastes + canonical duplicate reuse：real pass / blocked / not attempted
- Agent add_seed_reference + SSE：real pass / blocked / not attempted
- region candidates + host Figma MCP + primary confirmation：real pass / blocked / not attempted
- explicit Refresh + historical replay：real pass / blocked / not attempted

Secret review：pass / fail
备注：
```

## 本仓库自动化证据

- `tests/unit/seed-capture.test.ts`：同进程 command-kernel capture、multi-reference、canonical duplicate reuse、candidate query、explicit Refresh、事务回滚与 no-secret persistence；不替代完整 HTTP+MCP+SSE vertical。
- `tests/http-mcp-command-parity.spec.ts`：Active MCP discovery 与 HTTP/MCP contract。
- `tests/seed-evidence-workbench.spec.ts`：Runtime capture、SSE/Workbench projection，以及 retired endpoints。
- `tests/unit/pending-seed-evidence.test.ts` 与 `tests/unit/evidence-package.test.ts`：仅保护历史数据读取/回放兼容，不构成 Active 写入口。
