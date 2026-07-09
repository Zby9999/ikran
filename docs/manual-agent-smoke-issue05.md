# Issue 02/05 — 真实 Agent 手动冒烟：`record_evidence_package`

> 真实 Agent + 真实 Figma MCP 验证由你手动完成；本文件是前置条件、步骤与失败分类。
> 产品事实源：`Issues 02/05-agent-host-figma-evidence-declaration.md`。
> 前置：`docs/manual-agent-smoke-issue03.md`（`register_seed_reference`）+ Issue 02/04 Workbench。

本 slice：Agent host 用**自己的 Figma MCP**摄取 seed evidence，再通过 Ikran 的
`record_evidence_package` 声明最小 structured package。Runtime **只**校验 schema、写入
`figma_evidence_surfaces`、广播给 Workbench——**不访问 Figma**（无 fetch / oEmbed / `/api/figma/*`）。

Mock / Playwright 只能证明 schema、MCP 代理与 UI 投影路径；**不能**代替本文件的 Real Agent 步骤。

## Product conventions（Ikran MCP，非 workflow Skills）

这些约定写在 **Ikran MCP**（`bin/ikran-mcp.mjs` 的 server `instructions` 与相关 tool descriptions）里，由 Agent 在同一会话中遵守。它们**不是** Figma 插件默认值，也**不**编码在 `workflow/` Skills 中（见 `AGENTS.md` → Workflow vs Ikran MCP）。

1. **截图清晰度：`maxDimension: 4096`**  
   Agent 调用 host Figma MCP `get_screenshot` 时必须传 **`maxDimension: 4096`**（产品默认约定）。Figma MCP 自身默认常为 `1024`，大 frame 会被压糊；Workbench 按截图像素投影，长边显示上限同为 4096。不要依赖插件默认。

2. **两条 seed 注册路径，同一 pending 工作**  
   设计师可通过 **Workbench plus / EnterPanel**（HTTP `POST /api/seed-reference`）**或** Agent `register_seed_reference` 注册 seed。两条路径写入同一 `seed_references` 事实；尚无截图 Evidence Surface 的 seed 都是 **pending Agent evidence work**。

3. **Seed → evidence 编排（含 UI 发起）— AUTO-EXECUTE**  
   - Agent 路径：`register_seed_reference` 成功后**不是终点**——同一会话内立刻 Figma `get_screenshot`（4096）→ `record_evidence_package`。  
   - **UI 路径 / 打开 Workbench 后**：`open_workbench` / `list_pending_seed_evidence` 会返回 `pending_seed_evidence` 与 `fulfill_now`。对**每一条** pending seed：Figma MCP `get_screenshot`（`maxDimension: 4096`）→ Ikran `record_evidence_package`。  
   - **禁止询问**：发现 pending 时不得回复「如果需要，我可以继续」；必须在同一 turn 直接执行。  
   - **Host 限制**：UI 加号无法打断空闲 Agent；需要 Agent **下一轮**调用 Ikran（如 `open_workbench` / `list_pending_seed_evidence`）才能捡起 pending。

4. **Workbench awaiting UX（按注册来源区分）**  
   Seed 已注册、尚无带截图的 Evidence Surface 时：
   - **UI / EnterPanel**（`registered_via: ui`）：投影显示**引导文案**（请设计师让 Agents 调取 Figma screenshot），**不**显示加载圆圈。  
   - **Agent**（`registered_via: agent`）：投影显示 **loading 圆圈**，等待同一会话内 Agent 继续截图。  
   `record_evidence_package` 写入截图后，awaiting 结束并显示图像。

## 0. 前置条件

1. **Ikran Runtime 与 MCP 对齐**
   - `--prod`：先 `npm run build`，再重启 MCP host + Runtime（否则新 route 会 `route_not_found`）。
   - dev：MCP 配置去掉 `--prod`；仍须 **reload MCP servers**，让 `bin/ikran-mcp.mjs` 注册
     `record_evidence_package`、`list_pending_seed_evidence`（并加载上述 instructions）。
2. **MCP host 同时配置 Ikran + Figma MCP**（Cursor / Codex 等）。Figma MCP 负责读真实 seed page；
   Ikran 只收声明。
3. **`IKRAN_STATE_DIR` 与 UI 一致**（推荐项目级 `.ikran`，与 `setup_workspace` / Issue 02 一致）。
   错位会导致「tool 成功但 Workbench 看不到 surface」。
4. **活跃项目**：`create_or_open_project`（不带 path 或传当前工作区）。
5. **已注册 seed**（二选一，记下 `record.id` / pending 列表里的 `id`，后续优先传 `seedReferenceId`）：
   - Agent：`register_seed_reference`；或
   - 设计师：Workbench plus / EnterPanel（HTTP）。

## 1. 冒烟步骤

### 1a. Agent 路径：同会话 seed 注册后继续截图 + 声明

对设计师刚提供的 Figma seed，在**同一 Agent 会话**中：

1. `register_seed_reference`（成功后不要停）。
2. 立刻用 **Figma MCP**（非 Ikran）`get_screenshot`，**必须** `maxDimension: 4096`。
3. 可选：再取 raw / 节点结构（frame `nodeId` + `name`，可选 bounds）。
4. 立刻调用 Ikran `record_evidence_package`。

若只有一种 evidence view 可用：在 package 里对另一种标 `"missing"`，**不要猜、不要编造截图**。

需要时再对照截图响应里的 `original_width` / `original_height` 决定是否重取。

### 1a′. UI 路径：Workbench 注册 → pending list → 截图 + 声明

设计师在 Workbench 用 **plus / EnterPanel** 粘贴 Figma seed URL 并提交（HTTP，不经 Agent tool）：

1. Workbench 投影应立刻进入 **awaiting-evidence loading**，并显示 **“Waiting for Agent evidence capture”**。
2. Agent（`open_workbench` 之后，或协助 seed 录入 / 看到 awaiting 时）调用 Ikran **`list_pending_seed_evidence`**（无参）。
3. 对返回的**每一条** pending seed：Figma MCP `get_screenshot`（**`maxDimension: 4096`**）→ Ikran `record_evidence_package`（`seedReferenceId` = pending 项的 `id`）。
4. 全部完成后再次 `list_pending_seed_evidence` 应为空；Workbench loading 结束并显示截图。

### 1b. 组装最小 evidence package

```json
{
  "seedReferenceId": "<register_seed_reference 返回的 id>",
  "frame": { "nodeId": "1:2", "name": "Checkout", "bounds": { "x": 0, "y": 0, "width": 390, "height": 844 } },
  "evidenceViews": { "rawData": "available", "screenshot": "available" },
  "screenshot": { "dataUrl": "data:image/png;base64,..." },
  "surfaceBounds": { "width": 390, "height": 844 }
}
```

要点：

- `evidenceViews.rawData` / `screenshot` 必须是 `"available"` | `"missing"`。
- `screenshot === "available"` 时必须带 `screenshot.artifactPath` 和/或 `dataUrl`；`missing` 时不要带 payload。
- **Workbench 截图**：`dataUrl` 或项目内 `artifactPath` 均可；后者由 Runtime 经 `GET /api/artifacts/...?session=` 提供（需与 Workbench 同一 session）。

### 1c. 调用 `record_evidence_package`

预期 `ok: true` + `record`（`figma_evidence_surfaces`）+ `event_id`（`evidence_package_recorded`）+
`workbench_url`。

故意坏包应 `ok: false` + 结构化 error，且**不写** surface 行（并有 `invalid_output` 审计）。

### 1d. Workbench 核对

打开返回的 `workbench_url`（或 seed 注册后已打开的 Workbench）：

1. **在 evidence 到达前**：投影应显示 **awaiting-evidence loading**（seed 已在、尚无截图 surface），并带提示 **“Waiting for Agent evidence capture”**（Agent 路径与 UI plus 路径相同）。
2. **`record_evidence_package` 成功后**：loading 结束，tldraw 上出现 / 更新 Figma Evidence Surface，并显示截图（`dataUrl` 或 artifact URL）。可截屏留证。

### 1e. 落盘抽查（绑定项目的 `.ikran/`）

```bash
PROJ=<create_or_open_project 绑定的文件夹>
grep evidence_package_recorded "$PROJ/.ikran/events.jsonl"
node --input-type=module -e "import{DatabaseSync}from'node:sqlite';const db=new DatabaseSync('$PROJ/.ikran/ikran.db');console.log(db.prepare('SELECT id,frame_name,frame_node_id,seed_reference_id FROM figma_evidence_surfaces').all());db.close()"
```

## 2. 失败分类（记 open gap 时用）

| 标签 | 典型现象 |
|---|---|
| `blocked by Figma access` | Figma MCP 未授权 / 无权限 / 读不到 seed page 或截图 |
| `blocked by schema` | package 被拒（缺 frame、screenshot available 无 payload、URL 非法、dataUrl 过大等）→ `invalid_output`、无 surface |
| `blocked by host MCP tool discovery` | host 不暴露 `record_evidence_package`（或只暴露部分 Ikran tools） |
| `blocked by IKRAN_STATE_DIR mismatch` | tool 写成功但 UI / 另一进程看不到同一 `.ikran` 状态 |
| `blocked by Agent orchestration` | seed 已注册（Agent 或 UI）但 Agent 未 `list_pending_seed_evidence` / 未继续 4096 截图 / `record_evidence_package`，Workbench 一直 loading |

缺失 evidence view：在 package 里标 `"missing"`，并在冒烟日志写清是 access 还是 Agent 未取到。

## 3. Open gaps（实现侧已知）

- **Real Agent 未进 CI**：Playwright 覆盖 MCP valid / invalid / 零 Figma 触网、awaiting-evidence → screenshot；真实 Figma MCP 仍靠本手册。
- Figma MCP 可能只返回 raw 或 screenshot 之一——用 explicit missing，勿猜。
- Workbench 可通过 `GET /api/artifacts/<path>?session=…` 加载 `artifactPath` 截图（与 `dataUrl` 二选一即可）。
- **截图像素 vs 设计尺寸**：投影按截图 natural 像素 sizing（+ chrome），不按 `surface_bounds` 设计单位放大。
  取图时必须用 `get_screenshot` 的 `maxDimension: 4096`（产品约定；Figma 默认 1024 会明显偏糊）；Workbench 长边显示上限同为 4096。
- **约定归属**：seed→evidence 编排（含 UI pending + `list_pending_seed_evidence`）与 4096 约定在 Ikran MCP（`bin/ikran-mcp.mjs`），不在 `workflow/` Skills。

## 4. 冒烟日志模板

```
日期：
MCP： [ ] --prod（build + 重启）  [ ] dev（reload MCP）
  - reload 后工具列表有 record_evidence_package？ [ ] 是  [ ] 否 → blocked by host MCP tool discovery
  - reload 后工具列表有 list_pending_seed_evidence？ [ ] 是  [ ] 否 → blocked by host MCP tool discovery
  - Figma MCP 可用？ [ ] 是  [ ] 否 → blocked by Figma access

前置：
  - create_or_open_project？ [ ] 是（项目：____）
  - seed 注册路径： [ ] Agent register_seed_reference  [ ] Workbench plus/EnterPanel（HTTP）
  - seed id：____
  - IKRAN_STATE_DIR 与 UI 一致？ [ ] 是  [ ] 否 → blocked by IKRAN_STATE_DIR mismatch

Real Agent：
  - （Agent 路径）同会话：seed 后继续 get_screenshot(maxDimension:4096)？ [ ] 是  [ ] 否 / N/A
  - （UI 路径）open_workbench / 协助 seed 后调用 list_pending_seed_evidence？ [ ] 是  [ ] 否 / N/A → blocked by Agent orchestration
  - 对每条 pending：get_screenshot(maxDimension:4096) → record_evidence_package？ [ ] 是  [ ] 否 → blocked by Agent orchestration
  - Figma MCP 读到真实 seed page / 截图？ [ ] 是  [ ] 否（gap：____）
  - evidenceViews 显式 available/missing？ [ ] 是
  - record_evidence_package ok + surface？ [ ] 是  [ ] 否（error：____ → schema?）
  - Workbench：awaiting-evidence loading + “Waiting for Agent evidence capture”，后显示截图？ [ ] 是  [ ] 否
  - 落盘：evidence_package_recorded + figma_evidence_surfaces 行？ [ ] 是

备注 / open gaps：
```

## 5. 实现侧已完成的自动化验证（非 Real Agent）

- `record_evidence_package` HTTP + MCP；schema 失败 → `invalid_output`、无半写 surface。
- Workbench 轮询 `/api/evidence-package` 并投影（`dataUrl` / artifact URL 可显示截图）。
- Seed 无截图 surface 时投影 awaiting-evidence loading（含 “Waiting for Agent evidence capture”）；evidence 到达后显示截图（`tests/seed-evidence-workbench.spec.ts`）。
- UI / HTTP 注册 seed → `/api/pending-seed-evidence` 非空 → `record_evidence_package` 后 pending 清空（同 spec）。
- `list_pending_seed_evidence` MCP + `tests/pending-seed-evidence-unit.spec.ts`。
- `tests/evidence-package-unit.spec.ts`、`tests/evidence-package-mcp.spec.ts`：valid / invalid / Runtime 不触网 Figma。
