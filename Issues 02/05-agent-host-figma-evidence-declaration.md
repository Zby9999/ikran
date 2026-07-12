# Agent-Host Figma Evidence Declaration

## What to build

退役 Runtime 侧遗留 Figma validate/oEmbed 路径已在 Issue 02/04A 完成。本 issue 改为：Agent host 使用自己的 Figma MCP 摄取 seed evidence，然后通过 `record_evidence_package` 声明给 Runtime。Runtime 只保存 seed reference、校验 evidence package schema、创建 Figma Evidence Surface record，并广播给 Workbench。

这个 slice 必须用真实 Figma seed page 做一次 Agent host 验证；mock 只能证明 schema 和 UI 路径，不允许掩盖真实接入失败。

### 2026-07-10 后续架构收口

本 issue 历史正文与完成报告中的 **Workbench plus / EnterPanel 双入口 seed**、`registered_via: ui|agent` awaiting UX 分源等表述已被当前标准替代。当前 Active 契约：**Seed 纯 Agent-first**；Workbench 无 seed URL/intent 写入口；Evidence append-only + `superseded_by` / `current_surface_id`；canonical `file_key` / `node_id`；`record_evidence_package` 创建 Figma surface（无独立 `create_evidence_surface`）。**真实 Figma smoke 无本仓库可追溯完成证据，下方 Real Agent 两项改回未验证**；自动化路径仍视为完成。详见 PRD 与 ADR 0002。下文历史报告保留原文。

### 2026-07-12 Runtime-owned Figma ingestion 转型

本 issue 的 Agent-host screenshot/declaration 路径又被 ADR 0003 与当前 PRD 取代：Runtime 通过安装级 Figma Connection 直接捕获 positional evidence；Workbench paste 与 Agent `add_seed_reference` 共享 command；`list_pending_seed_evidence` / Agent-supplied `record_evidence_package` 退出 Active 工具面。下方 unchecked Real Agent validation 继续保留为历史未验证事实，但不再是新产品路径的 blocker；真实转型验收由 05A–05D 承担。历史完成报告不改写。

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

- [ ] 使用真实 Agent host + 已配置 Figma MCP + 真实 Figma seed page 生成最小 evidence package。（**未验证**：无本仓库可追溯的真实 Figma smoke 证据。）
- [ ] Agent 通过 Ikran tool 声明 package，Runtime 创建 Figma Evidence Surface。（**未验证**：同上；自动化 MCP/HTTP/Workbench 路径已覆盖，不代替真实 Figma。）
- [ ] 如果 Figma MCP 不可用、权限不足或截图/结构化证据缺失，必须记录 open gap 和缺失 evidence view。

> Real Agent 步骤与失败分类：`docs/manual-agent-smoke-issue05.md`。真实 Figma MCP 两项保持未勾选；勿将自动化完成误读为真实 Figma smoke 完成。



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
- **UX 编排（产品约定，Ikran MCP）：** Seed 可由 Agent `register_seed_reference` **或** Workbench plus / EnterPanel（HTTP）注册；截图 surface 到达前的 awaiting UX 按来源区分——**UI 注册**显示引导文案（请用 Agents 调取 Figma screenshot，无 spinner）；**Agent 注册**显示 loading 圆圈。Agent 路径：注册成功后立刻 Figma `get_screenshot`（`maxDimension: 4096`）→ `record_evidence_package`。UI / Workbench 路径：`open_workbench` 后及协助 seed 录入时必须 `list_pending_seed_evidence`，对每条 pending 同样 4096 截图 → `record_evidence_package`。约定写在 `bin/ikran-mcp.mjs` instructions / tool descriptions，**不**写在 `workflow/` Skills（见 `AGENTS.md`；步骤见 `docs/manual-agent-smoke-issue05.md`）。



## Blocked by

- `03-semantic-mcp-tool-boundary-mock-client.md`
- `04-tldraw-workbench-shell-seed-entry.md`

---



## 完成报告（要点）

- **状态**：Issue 05 **自动化路径完成**（schema / persist / MCP / Workbench 投影 / pending seed evidence）。**Real Agent + 真实 Figma MCP 两项未验证**（无本仓库可追溯完成证据；见上方 Real Agent validation 与 `docs/manual-agent-smoke-issue05.md`）。自动化完成 ≠ 真实 Figma smoke 完成。
- **本轮收尾（UX + 审计加固）**：
  - **Awaiting UX 分源**：`seed_references.registered_via`（`ui` | `agent`）。UI EnterPanel 显示引导文案（无 spinner）；Agent `register_seed_reference` 显示 loading 圆圈。
  - **截图角点缩放**：有截图时放大上限为自然像素 + chrome；缩小仍可；无截图自由缩放。
  - **Description tip**：`scale(1/zoom)` 屏幕恒定（max 300px），仍锚在 info 图标。
  - **Surface 选择**：同 seed 多 surface 时「有截图 → 较新 → 显式 link → id」；URL fallback 不抢其他 seed 的显式 surface。
  - `dataUrl` **边界**：仅允许 `data:image/(png|jpeg|jpg|webp|gif);base64,...`，拒绝 https 等外链。
- **关键文件**：`lib/runtime/{seed-reference,evidence-package,db}.ts`、`find-surface-for-seed.ts`、`seed-reference-resize-clamp.ts`、`seed-reference-description-tip.tsx`、`app/api/artifacts/`、Workbench 投影与 e2e/unit 测试、smoke / Issue 文档。
