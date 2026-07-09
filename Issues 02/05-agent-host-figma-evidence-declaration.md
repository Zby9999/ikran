# Agent-Host Figma Evidence Declaration

## What to build

退役 Runtime 侧遗留 Figma validate/oEmbed 路径已在 Issue 02/04A 完成。本 issue 改为：Agent host 使用自己的 Figma MCP 摄取 seed evidence，然后通过 `record_evidence_package` 声明给 Runtime。Runtime 只保存 seed reference、校验 evidence package schema、创建 Figma Evidence Surface record，并广播给 Workbench。

这个 slice 必须用真实 Figma seed page 做一次 Agent host 验证；mock 只能证明 schema 和 UI 路径，不允许掩盖真实接入失败。

## User stories covered

- 8, 9, 12, 64, 65

## Acceptance criteria

- [x] Runtime 不再调用 Figma oEmbed/API 做 seed validation。（由 Issue 02/04A 删除 `/api/figma/validate` 完成；本 issue 不再重复退役。）
- [x] `record_evidence_package` 接收 Agent host 返回的 structured evidence package。（HTTP `POST /api/evidence-package` + MCP tool；自动化已覆盖，Real Agent 见下方。）
- [x] Runtime 校验 evidence package schema，失败时记录 invalid-output 事件。
- [x] 校验通过后创建 Figma Evidence Surface canvas record。
- [x] Workbench 在 tldraw 中投影 Figma Evidence Surface。（截图可用 `dataUrl` 或项目内 `artifactPath`；seed 无截图时显示 awaiting-evidence loading。见 `docs/manual-agent-smoke-issue05.md`。）
- [x] 测试覆盖 valid package、invalid package、Runtime 不触网访问 Figma。

## Real Agent validation

- [ ] 使用真实 Agent host + 已配置 Figma MCP + 真实 Figma seed page 生成最小 evidence package。
- [ ] Agent 通过 Ikran tool 声明 package，Runtime 创建 Figma Evidence Surface。
- [ ] 如果 Figma MCP 不可用、权限不足或截图/结构化证据缺失，必须记录 open gap 和缺失 evidence view。

> Real Agent 步骤与失败分类：`docs/manual-agent-smoke-issue05.md`（本会话未跑真实 Figma MCP，故上方三项保持未勾选）。

## Likely difficulties for Agent

- 真实 Figma MCP 可能只返回 raw data 或 screenshot 中的一种 evidence view。
- Agent 可能把截图转代码当作主要输入，而不是 structured evidence。
- Evidence package schema 太严格会让真实 Agent 难以一次成功，太宽又会污染后续 design-system extraction。
- Agent 可能在 `register_seed_reference` 后停止，未继续 Figma `get_screenshot`（4096）+ `record_evidence_package`，导致 Workbench 一直 awaiting-evidence。
- 设计师经 Workbench plus / EnterPanel（HTTP）注册 seed 后，Agent 可能未调用 `list_pending_seed_evidence`，同样留下 awaiting-evidence loading。

## Suggested ways through

- 采用最小 evidence package：seed reference、frame/node identity、raw evidence availability、screenshot availability、surface bounds、关键 design signals。
- 缺失 evidence view 用 explicit missing 标记，不让 Agent 猜。
- 在 smoke 记录中区分 blocked by Figma access、blocked by schema、blocked by host MCP tool discovery、blocked by Agent orchestration。
- **UX 编排（产品约定，Ikran MCP）：** Seed 可由 Agent `register_seed_reference` **或** Workbench plus / EnterPanel（HTTP）注册；任一路径在截图 surface 到达前显示 awaiting-evidence loading（提示 “Waiting for Agent evidence capture”）。Agent 路径：注册成功后立刻 Figma `get_screenshot`（**`maxDimension: 4096`**）→ `record_evidence_package`。UI / Workbench 路径：`open_workbench` 后及协助 seed 录入时必须 `list_pending_seed_evidence`，对每条 pending 同样 4096 截图 → `record_evidence_package`。约定写在 `bin/ikran-mcp.mjs` instructions / tool descriptions，**不**写在 `workflow/` Skills（见 `AGENTS.md`；步骤见 `docs/manual-agent-smoke-issue05.md`）。

## Blocked by

- `03-semantic-mcp-tool-boundary-mock-client.md`
- `04-tldraw-workbench-shell-seed-entry.md`
