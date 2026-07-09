# Issue 02/05 — 真实 Agent 手动冒烟：`record_evidence_package`

> 真实 Agent + 真实 Figma MCP 验证由你手动完成；本文件是前置条件、步骤与失败分类。
> 产品事实源：`Issues 02/05-agent-host-figma-evidence-declaration.md`。
> 前置：`docs/manual-agent-smoke-issue03.md`（`register_seed_reference`）+ Issue 02/04 Workbench。

本 slice：Agent host 用**自己的 Figma MCP**摄取 seed evidence，再通过 Ikran 的
`record_evidence_package` 声明最小 structured package。Runtime **只**校验 schema、写入
`figma_evidence_surfaces`、广播给 Workbench——**不访问 Figma**（无 fetch / oEmbed / `/api/figma/*`）。

Mock / Playwright 只能证明 schema、MCP 代理与 UI 投影路径；**不能**代替本文件的 Real Agent 步骤。

## 0. 前置条件

1. **Ikran Runtime 与 MCP 对齐**
   - `--prod`：先 `npm run build`，再重启 MCP host + Runtime（否则新 route 会 `route_not_found`）。
   - dev：MCP 配置去掉 `--prod`；仍须 **reload MCP servers**，让 `bin/ikran-mcp.mjs` 注册
     `record_evidence_package`。
2. **MCP host 同时配置 Ikran + Figma MCP**（Cursor / Codex 等）。Figma MCP 负责读真实 seed page；
   Ikran 只收声明。
3. **`IKRAN_STATE_DIR` 与 UI 一致**（推荐项目级 `.ikran`，与 `setup_workspace` / Issue 02 一致）。
   错位会导致「tool 成功但 Workbench 看不到 surface」。
4. **活跃项目**：`create_or_open_project`（不带 path 或传当前工作区）。
5. **已注册 seed**：`register_seed_reference`（记下返回的 `record.id`，后续优先传 `seedReferenceId`）。

## 1. 冒烟步骤

### 1a. Agent 用 Figma MCP 读真实 seed page

对已注册的 Figma seed URL，让 Agent 通过 **Figma MCP**（非 Ikran）拉取至少一种证据：

- raw / 节点结构（frame `nodeId` + `name`，可选 bounds）
- 和/或 screenshot

若只有一种可用：在 package 里对另一种标 `"missing"`，**不要猜、不要编造截图**。

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
- **Workbench 要显示截图**：MVP 请用 `dataUrl`（见下方 open gaps）。仅 `artifactPath` 会落盘，但 UI 暂不 file-serve。

### 1c. 调用 `record_evidence_package`

预期 `ok: true` + `record`（`figma_evidence_surfaces`）+ `event_id`（`evidence_package_recorded`）+
`workbench_url`。

故意坏包应 `ok: false` + 结构化 error，且**不写** surface 行（并有 `invalid_output` 审计）。

### 1d. Workbench 核对

打开返回的 `workbench_url`：tldraw 上应出现 / 更新 Figma Evidence Surface 投影（frame 名；有
`dataUrl` 时应看到截图）。可截屏留证。

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

缺失 evidence view：在 package 里标 `"missing"`，并在冒烟日志写清是 access 还是 Agent 未取到。

## 3. Open gaps（实现侧已知）

- **`artifactPath` 未在 UI file-serve**：Workbench 投影截图依赖 `screenshot_data_url`；仅 path 时 shape 可提示「有 artifact 无预览」。
- **Real Agent 未进 CI**：Playwright 覆盖 MCP valid / invalid / 零 Figma 触网；真实 Figma MCP 仍靠本手册。
- Figma MCP 可能只返回 raw 或 screenshot 之一——用 explicit missing，勿猜。

## 4. 冒烟日志模板

```
日期：
MCP： [ ] --prod（build + 重启）  [ ] dev（reload MCP）
  - reload 后工具列表有 record_evidence_package？ [ ] 是  [ ] 否 → blocked by host MCP tool discovery
  - Figma MCP 可用？ [ ] 是  [ ] 否 → blocked by Figma access

前置：
  - create_or_open_project？ [ ] 是（项目：____）
  - register_seed_reference？ [ ] 是（seed id：____）
  - IKRAN_STATE_DIR 与 UI 一致？ [ ] 是  [ ] 否 → blocked by IKRAN_STATE_DIR mismatch

Real Agent：
  - Figma MCP 读到真实 seed page？ [ ] 是  [ ] 否（gap：____）
  - evidenceViews 显式 available/missing？ [ ] 是
  - record_evidence_package ok + surface？ [ ] 是  [ ] 否（error：____ → schema?）
  - Workbench 投影可见（有 dataUrl 则见图）？ [ ] 是  [ ] 否
  - 落盘：evidence_package_recorded + figma_evidence_surfaces 行？ [ ] 是

备注 / open gaps：
```

## 5. 实现侧已完成的自动化验证（非 Real Agent）

- `record_evidence_package` HTTP + MCP；schema 失败 → `invalid_output`、无半写 surface。
- Workbench 轮询 `/api/evidence-package` 并投影（`dataUrl` 可显示截图）。
- `tests/evidence-package-unit.spec.ts`、`tests/evidence-package-mcp.spec.ts`：valid / invalid / Runtime 不触网 Figma。
