# Issue 02/03 — 真实 Agent 手动冒烟测试：`register_seed_reference`

> 真实 Agent 验证由你手动完成；本文件是设置步骤与逐项引导。
> 产品事实源：`Issues 02/03-semantic-mcp-tool-boundary-mock-client.md`、
> `IKRAN-MVP-PRD.zh-CN.md`。前置：`docs/manual-agent-smoke-issue02.md`（项目绑定）。

这个 slice 实现 `register_seed_reference`——Agent 通过**语义 MCP tool**把 Figma seed
URL + 原始设计意图写进 Runtime-owned 事实源，证明 Agent 不能靠 raw exec / headless CLI /
canvas geometry 直接改研究事实源。它只做**本地格式校验**（https、`figma.com` / `www.figma.com`、
`/design/<key>` 或 `/file/<key>`），原样保存 URL，**不访问 Figma、不 fetch、不 oEmbed**。

## 事实源 vs 审计（重要语义）

- `seed_references` 专用表 = **当前事实源**（查询用）。
- `seed_reference_registered` event = **审计日志**（best-effort）。
- record 先写并提交，event 随后追加。极端 I/O 失败时可能出现「有 record 无 event」——这是
  **审计缺口**，不是事实源损坏（当前事实仍完整可查）。「有 event 无 record」不会发生（event 只在
  record 写成功后才写）。本 slice **不做事务化**，这是已接受的取舍。

## 0. 关键：`--prod` 的构建 + 重启闸门（404 的根因）

`register_seed_reference` 调用的是 HTTP route `POST /api/seed-reference`。`--prod` 模式下
Runtime 服务的是**冻结的构建产物**。如果你 `npm run build` 出了新 route，但旧 Runtime 还在跑，
调用会 **HTTP 404** → MCP tool 返回结构化错误 `route_not_found`（已诊断化，不是崩溃）。

**合并前的 smoke setup，二选一：**

- **(A) `--prod` 路径**：`npm run build` 后，**重启 MCP host（Cursor reload MCP servers）+ 重启
  Runtime**（kill 旧 `next-server`、删 `runtime-endpoint.json` 复用指针），让新构建被服务。
- **(B) dev 路径**：MCP 配置去掉 `--prod`。route 由 `next dev` 热重载，无需 build；但**仍需 reload
  一次 MCP host**，因为 `register_seed_reference` 这个 tool 是 MCP server 启动时注册的（旧 MCP
  server 进程没有它）。

> 无论哪条：**reload MCP host 是必须的**（让 `bin/ikran-mcp.mjs` 重新注册 tool）。
> `--prod` 额外需要 build + 重启 Runtime。dev 模式只需 reload MCP host（route 热重载）。

## 1. 推荐流程（dev 模式，零构建最快）

```bash
# 终端 A：dev 模式起 workbench（可选；MCP server 也会自己起 Runtime）
npm run dev
```

MCP 配置用 dev 模式（见第 2 步，去掉 `--prod`）。reload MCP 后即可。

或 `--prod`：

```bash
npm run build
# 然后清掉 stale runtime，再 reload MCP（见第 4 步排错）
```

## 2. Cursor MCP 配置

沿用 02/02 的项目级 `.cursor/mcp.json`，绝对路径指向 `bin/ikran-mcp.mjs`：

```json
{
  "mcpServers": {
    "ikran": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/recursive-design-agent/bin/ikran-mcp.mjs", "--prod"],
      "env": { "IKRAN_HOST": "127.0.0.1" }
    }
  }
}
```

- `--prod` 仅在 `npm run build` 之后用；零构建 dev 模式去掉 `--prod`。
- 想按项目隔离状态：加 `"env.IKRAN_STATE_DIR": "<workspace>/.ikran"`。
- 编辑后 **reload MCP servers**（或重启 Cursor）——让它发现带 `register_seed_reference` 的 ikran。

## 3. 真实 Agent 流程（你手动跑的部分）

### 3a. 先绑定项目（register_seed_reference 需要活跃项目）

在 Cursor 对话里：

> 用 ikran 的 create_or_open_project 绑定当前项目（不带 path，或传 { path: "<空文件夹>" }）。

预期：返回 `ok: true` + project + session + workbench_url。
若传了**另一个**文件夹而 Runtime 已绑定别的项目 → 返回 `project_mismatch`（单项目单流程，
fail closed，不静默切换——这是正确行为）。

### 3b. 注册 seed reference

> 用 ikran 的 register_seed_reference 记录：figmaSeedReference =
> "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2"，originalDesignIntent =
> "探索结账流程的信任信号"。

预期 `structuredContent`：

```json
{
  "ok": true,
  "record": {
    "id": "<uuid>",
    "figma_seed_reference": "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2",
    "original_design_intent": "探索结账流程的信任信号",
    "created_at": "<ISO8601>"
  },
  "event_id": "<uuid>",
  "session": "<token>",
  "workbench_url": "http://127.0.0.1:<port>/?session=<token>"
}
```

**关键核对**：`record.figma_seed_reference` 与传入**完全一致**（`?node-id=1:2` 保留，未被
normalize / 截断）。

### 3c. 校验失败应返回结构化错误、不写半成品

故意传坏值，预期 `ok: false` + 具体 error，且不写 record / event：

| 输入 | 预期 error |
|---|---|
| 空 URL | `missing_figma_seed_reference` |
| 空 intent | `missing_original_design_intent` |
| `http://...`（非 https） | `invalid_figma_url` |
| `https://example.com/design/...` | `not_figma_host` |
| `https://www.figma.com/other/...` | `not_figma_design_path` |

## 4. 验证落盘（在**绑定项目**的 `.ikran/`，不是 `~/.ikran/`）

```bash
PROJ=<你 create_or_open_project 绑定的那个文件夹>
grep seed_reference_registered "$PROJ/.ikran/events.jsonl"
node --input-type=module -e "import{DatabaseSync}from'node:sqlite';const db=new DatabaseSync('$PROJ/.ikran/ikran.db');console.log(db.prepare('SELECT id,figma_seed_reference,original_design_intent FROM seed_references').all());db.close()"
```

预期：`events.jsonl` 有 1 条 `seed_reference_registered`；SQLite `seed_references` 有 1 行，
URL 原样。

## 5. curl 兜底（当 Cursor 不暴露该 tool 时）

你之前的记录里 Cursor 偶尔只暴露 `open_workbench`（Cursor 侧 tool-exposure bug）。若 Agent 看不到
`register_seed_reference`，先让 Agent 调 `open_workbench` 拿到 URL 里的 `<port>` 和 `<token>`，
然后直接打 route（证明边界本身没问题）：

```bash
PORT=<port>   TOK=<token>
# 若无活跃项目，先 bind：
curl -s -X POST "http://127.0.0.1:$PORT/api/project/bind" \
  -H "x-ikran-session: $TOK" -H "Content-Type: application/json" \
  -d '{"path":"<空文件夹>"}' >/dev/null
# 注册：
curl -s -X POST "http://127.0.0.1:$PORT/api/seed-reference" \
  -H "x-ikran-session: $TOK" -H "Content-Type: application/json" \
  -d '{"figmaSeedReference":"https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2","originalDesignIntent":"test"}' | python3 -m json.tool
# 无 token 应被拒（403）：
curl -s -o /dev/null -w '%{http_code}\n' -X POST "http://127.0.0.1:$PORT/api/seed-reference" \
  -H "Content-Type: application/json" -d '{"figmaSeedReference":"https://www.figma.com/design/x/y","originalDesignIntent":"x"}'
```

## 6. 排错：真实 Agent 返回 HTTP 404 / `route_not_found`

MCP tool 现在会明确返回 `error: "route_not_found"`，detail 提示 stale Runtime。处理：

```bash
pkill -f "ikran-mcp.mjs"; pkill -f "next-server"
rm -f ~/.ikran/runtime-endpoint.json "<workspace>/.ikran/runtime-endpoint.json"
npm run build          # 仅 --prod 需要
# 回 Cursor reload MCP servers
```

然后重试。dev 模式只需 reload MCP host（route 热重载）。

## 7. Codex Desktop

配置同样的 MCP 命令，跑 3a–3c。若 Codex **能发现并调用** `register_seed_reference` → 记录成功。
若 Codex **不暴露/不能发现**工具（已知 MCP tool 暴露 bug）→ 对 02/03 是**可接受结果**（issue 允许
记 open gap + fallback）。Fallback：用第 5 步的 curl 直接打 route（仍能证明语义边界成立）。

## 8. 冒烟日志模板（填好后放 `.plans/issue02-03/`）

```
日期：
MCP 启动方式： [ ] --prod（npm run build + 重启）  [ ] dev（去 --prod，reload MCP host）
  - reload MCP host 后 register_seed_reference 出现在工具列表？ [ ] 是  [ ] 否

register_seed_reference：
  - create_or_open_project 先绑定成功？ [ ] 是（项目：____） [ ] project_mismatch（预期，若传了别的文件夹）
  - 合法 URL 注册返回 ok + record？ [ ] 是  [ ] 否（错误：____）
  - record.figma_seed_reference 与传入完全一致（含 ?node-id）？ [ ] 是  [ ] 否
  - 返回 event_id？ [ ] 是  [ ] 否
  - 5 种非法输入各返回结构化 error、不写 record/event？ [ ] 是  [ ] 否
  - 落盘：events.jsonl 有 seed_reference_registered？ [ ] 是
  - 落盘：SQLite seed_references 有 1 行、URL 原样？ [ ] 是
  - 无 token curl -> 403？ [ ] 是

404 / stale runtime：
  - 是否命中 route_not_found？ [ ] 否（直接成功）  [ ] 是 → 按第 6 步重启后恢复？ [ ] 是

Codex Desktop：
  - 工具被发现并调用？ [ ] 是  [ ] 否 → open gap：____ ；fallback：[ ] curl  [ ] ____

备注 / open gaps：
```

## 9. 仅限 localhost——使用须知

Workbench URL 与 session token 是**仅本地、随启动而定**的（Runtime 退出即失效）。不要转发到远端
或当公开链接。`register_seed_reference` 不联网、不验证 Figma 链接存在性——真实链接有效性交给
Agent 或后续 Figma ingestion 流程。

## 实现侧已完成的验证

- `npm run typecheck` 通过。
- `npx playwright test tests/seed-reference-mcp.spec.ts` 通过（3 个：成功 / 校验失败不写半成品 /
  fail-closed：无项目 `no_active_project` + 无 token 403）。`open-workbench-mcp` + `project-session-mcp`
  无回归。
- 自包含 HTTP smoke（不经 Cursor）已对账：合法 URL → ok + URL 原样 + event_id；非法 → 结构化 400 不写；
  无项目 → `no_active_project`；无 token → 403。