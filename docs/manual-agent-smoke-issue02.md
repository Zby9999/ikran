# Issue 02/02 — 真实 Agent 手动冒烟测试：设置与引导

> 真实 Agent 验证由你手动完成；本文件是设置步骤与逐项引导。
> 产品事实源：`Issues 02/02-project-session-binding-ikran-metadata.md`、
> `IKRAN-MVP-PRD.zh-CN.md`、`docs/adr/0001-pivot-to-agent-desktop-fusion.md`。

这个 slice 让 **Agent 通过与 Workbench HTTP API 相同的 project/session 上下文来绑定/打开项目**；并且——因为 Ikran 现在是在 Agent 对话里打开的插件——**工作文件夹在对话开始前就选好了**（你在 Cursor/Codex 里打开的那个文件夹）。Workbench 不再让你选文件夹；它直接绑定那个工作文件夹。

Agent host 会 spawn `bin/ikran-mcp.mjs`，它暴露四个工具：

- `open_workbench`（来自 02/01）——返回 Workbench URL
  `http://127.0.0.1:{port}/?session={token}`。
- `create_or_open_project({ path? })`（02/02）——绑定或打开 project/session 并初始化
  `.ikran/`。不带 `path` 时它**从 MCP 客户端的 workspace Roots 发现工作文件夹**（或
  `IKRAN_CWD` env）。如果 Runtime 已经绑定到*另一个*项目，它会**fail closed 返回
  `project_mismatch`**。
- `list_working_folders()`（02/02）——只读；显示发现了哪个工作文件夹、来源是什么
  （Roots / env / none）。用来确认绑定目标。
- `setup_workspace({ path })`（02/02）——**通用、不依赖 Roots 的引导**。传入当前文件夹
  （`pwd`）；它返回精确的 MCP 配置片段（`cwd` + `env.IKRAN_STATE_DIR = <path>/.ikran`），
  由 **Agent** 写入 `<path>/.cursor/mcp.json` 后重载。不依赖 Roots 就能把工作区钉住，
  并给每个项目独立的状态（多个项目并存时彼此隔离）。

## 这个 slice 构建了什么

- `bin/ikran-mcp.mjs`——`create_or_open_project` + `list_working_folders`，以及
  `discoverWorkingFolder()` 解析 Agent host 的工作文件夹，**不使用 `process.cwd()`**
  （Cursor 把它设成用户目录，而不是工作区）：
  1. `process.env.IKRAN_CWD`（mcp.json env 里的显式覆盖），然后
  2. **MCP Roots**——`mcp.server.listRoots()` 向客户端询问其 workspace 文件夹；第一个
     `file://` root 转成路径（这是协议层面让 server 发现客户端工作区的标准方式），然后
  3. none（都没有）。
  `ensureRuntime()` 把发现的文件夹作为 `IKRAN_CWD` 转发给 Runtime，让 Workbench 能显示它。
  如果什么都没发现，就不转发 `IKRAN_CWD`，`create_or_open_project({})` 会返回
  `no_working_folder`（这时 Agent 应传 `{ path }`——它的 shell `pwd` 就是工作区）。
- `bin/ikran-mcp.mjs` 还暴露了 `setup_workspace({ path })`——通用、不依赖 Roots 的引导。
  Agent 传 `pwd`；工具返回精确的 MCP 配置片段（`mcpServers.ikran`，含 `cwd = <path>` 和
  `env.IKRAN_STATE_DIR = <path>/.ikran`），由 **Agent** 写入 `<path>/.cursor/mcp.json`
  （工具**不写文件**——透明、不侵入），然后重载 Cursor 的 MCP servers。重载后 server 以正确
  的工作区启动，并带**按项目独立的状态**（`IKRAN_STATE_DIR = <workspace>/.ikran` → 每个
  项目有自己的 active-project 指针 + Runtime → 多项目并存彼此隔离）。Roots 仍是零配置的
  自动路径；`setup_workspace` 是通用 fallback，同时带来持久化 + 按项目隔离。
- `components/setup/ProjectSetupCard.tsx` + `FolderSelectStep.tsx`——文件夹步骤**不再选
  文件夹**。工作文件夹里已有 `.ikran` 时自动完成（resume）；否则提供一个一键
  **Initialize here**，在该文件夹里创建 `.ikran/`（空文件夹*或*与已有文件并存）。原生
  文件夹选择器和手动输入路径的 fallback 已移除；`inside-folder` 变体及其 "Use this folder
  directly" 子按钮已移除。标签 `Select a Folder` → `Project Folder`；helper 文案按状态改写。
  **视觉布局不变**（最终文案待设计师按 Figma 定稿）。
- 已移除：`app/api/project/select-folder/route.ts`、`lib/runtime/folder-picker.ts`（原生
  picker 没了）。`lib/runtime/cwd-candidate.ts` 的 `isAutoBindable` 现在只认 resume（空文件夹
  要等点击，不再静默 auto-bind）。
- 已有（未改、承重）：`lib/runtime/project.ts`（`bindProjectFolder` 创建 `.ikran/` + SQLite +
  events + 设置 active 指针）、`lib/runtime/db.ts`、`lib/runtime/events.ts`、
  `lib/runtime/paths.ts`，HTTP 路由 `/api/project` + `/api/project/bind` + `/api/agent/connect`
  （mismatch 时已返回 409），以及 UI 的刷新恢复。
- 测试：`tests/project-session-mcp.spec.ts`（roots/list 发现 + `list_working_folders` +
  `no_working_folder` fallback + `setup_workspace` + 显式 path / mismatch / 刷新路径）；
  `cwd-auto-bind.spec.ts`、`ikran-runtime-health.spec.ts`、`agent-switch.spec.ts` 已按新流程更新。
- 一进程整合（MCP handler 与 HTTP API 共享内存记录状态）是 **Issue 02/03** 的后续工作——
  不在本 slice。

> **重要——工作文件夹的发现。** MCP server 通过 **MCP Roots**（`roots/list`——客户端暴露其
> workspace 文件夹）发现工作文件夹，以显式 `IKRAN_CWD` env 覆盖作为 fallback。它**不使用
> `process.cwd()`**（Cursor 把它设成用户目录）。所以：**用你的研究文件夹作为项目打开
> Cursor/Codex**——如果 Cursor 暴露 Roots（VS Code 会；Cursor 大概率也会），Workbench 会自动
> 发现它。**这是冒烟测试里首先要确认的**——调用 `list_working_folders`（或看 Workbench 的
> 文件夹步骤）：它显示的是*你的*研究文件夹吗？如果不是（Cursor 不支持 Roots），在 MCP 配置里
> 设 `"env": { "IKRAN_CWD": "/absolute/path/to/your/research/folder" }`，或让 Agent 向
> `create_or_open_project` 传 `{ path }`。如果想一次性、按项目固定并且隔离并存项目，用
> `setup_workspace({ path })`（见 4f）——Agent 把 `cwd` + `IKRAN_STATE_DIR` 写进
> `.cursor/mcp.json`，你重载一次即可。

## 0. 一次性构建（仅 `--prod` 需要；dev 模式可跳过）

```bash
npm run build
```

> 如果用 dev 模式跑 MCP server（不带 `--prod`）就可跳过。dev 模式（`next dev`）在第一次工具
> 调用时编译（首次调用较慢，无需构建步骤）。`--prod` 更快但需要上面的构建。

## 1. 推荐流程（最快）：用 `--prod` 启动 workbench，让 Agent 复用它

在终端里运行：

```bash
npm run build                          # 一次性（仅 --prod 需要）
node bin/ikran.mjs --prod --no-open --folder ~/ikran-smoke-empty-1
```

零构建 fallback（dev）：

```bash
npm start -- --folder ~/ikran-smoke-empty-1   # = node bin/ikran.mjs（dev，自动端口）
```

它会打印，例如：

```
[ikran] Workbench URL: http://127.0.0.1:54321/?session=abc...
[ikran] Local-only. Open it in any browser (ideal: your Agent host's embedded browser).
```

保持运行。当 Agent 调用 `open_workbench` / `create_or_open_project` 时，MCP server 会**复用**
这个已经在跑的 Runtime（同样的 URL + token），而不是再起一个。（`--folder` 设的是 launcher
转发的 cwd；MCP 路径通过 Roots / `IKRAN_CWD` 发现文件夹——见上面的说明。）

> **Cursor 内嵌浏览器注意（与 02/01 相同）：** 在 `next dev` 下，Cursor 内置浏览器会在
> hydration 前给 HTML 标注 `data-cursor-ref`，产生一个无害的 React hydration 警告。用
> `--prod` 可得到干净的控制台；两种模式下页面都正常工作。

## 2. 准备两个空文件夹 + 用其中一个作为工作文件夹打开 Cursor

工作文件夹是你要绑定的那个；第二个文件夹只是 mismatch 检查用的*不同路径*。先建好：

```bash
mkdir -p ~/ikran-smoke-empty-1
mkdir -p ~/ikran-smoke-empty-2
```

**用 `~/ikran-smoke-empty-1` 作为项目文件夹打开 Cursor**（File → Open Folder）。如果 Cursor
暴露 MCP Roots，Ikran MCP server 会自动把它识别为工作文件夹。（如果不支持，你就在第 3 步显式
设 `IKRAN_CWD`，或让 Agent 传 `{ path }`。）

## 3. Cursor MCP 配置

给 Cursor 加一个 `ikran` MCP server。项目级（`.cursor/mcp.json`）或用户级均可——用**绝对**路径
指向仓库的 `bin/ikran-mcp.mjs`：

```json
{
  "mcpServers": {
    "ikran": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/recursive-design-agent/bin/ikran-mcp.mjs", "--prod"],
      "env": {
        "IKRAN_HOST": "127.0.0.1"
      }
    }
  }
}
```

- 仅在 `npm run build` 之后才用 `--prod`。零构建 dev 模式去掉 `--prod`（首次调用较慢）。
- 只有在 Cursor **不**暴露 Roots 时才加 `IKRAN_CWD`（先在第 4a 步确认）：
  `"env": { "IKRAN_HOST": "127.0.0.1", "IKRAN_CWD": "/Users/you/ikran-smoke-empty-1" }`。
- 如果你用第 1 步以默认 state dir（`~/.ikran`）启动了 workbench，Agent 的工具会复用它。要隔离
  的话，加 `"IKRAN_STATE_DIR": "/tmp/ikran-cursor"`。

编辑后重载 Cursor 的 MCP servers（或重启），让它发现带 `open_workbench`、
`create_or_open_project`、`list_working_folders`、`setup_workspace` 的 `ikran`。

## 4. 真实 Agent 流程（你手动跑的部分）

### 4a. Agent 打开 workbench + 你确认发现的文件夹

在 Cursor 对话里说：

> 打开 Ikran / open the Ikran workbench.

预期：Agent 调用 `open_workbench` 并返回一个 `http://127.0.0.1:<port>/?session=<token>` URL。
打开它（Cursor 内嵌浏览器，或复制到系统浏览器）。确认 shell 渲染出来并显示
**`Local runtime connected`**。

然后**确认工作文件夹的发现**——让 Agent：

> Ikran 看到的工作文件夹是哪个？/ call list_working_folders.

预期：`list_working_folders()` 返回 `{ folder, source, roots }`。**这是关键检查**：`folder`
应当是 `.../ikran-smoke-empty-1`，`source` 应当是 `"roots"`（Cursor 暴露了工作区）。如果
`folder` 是 null / `source` 是 `"none"`，说明 Cursor 没暴露 Roots——在 MCP 配置（第 3 步）里
设 `IKRAN_CWD` 并重载，或让 Agent 在 4b 传 `{ path }`。记录是哪种情况。

### 4b. 绑定工作文件夹（一键 Initialize，或通过 Agent）

文件夹步骤应当显示**你的工作文件夹**（`.../ikran-smoke-empty-1`）：

- 如果那里已有 `.ikran` → 自动显示 **`Complete! .../ikran-smoke-empty-1`**；
- 否则 → helper **`Click to initialize the project folder`**。

**方案 A——设计师点击（新 UX）：** 在 Workbench 里点 **Project Folder** 那一行。它会在工作
文件夹里创建 `.ikran/` 并切到 **`Complete! .../ikran-smoke-empty-1`**。

**方案 B——Agent 绑定（不带 path，用 Roots 发现）：** 让 Agent：

> 为这个工作区 create or open the Ikran project.

预期：Agent 调用 `create_or_open_project({})`（不带 path）→ server 通过 Roots 发现工作文件夹
→ 绑定 → 返回 project + session + Workbench URL。Workbench 随后显示
**`Complete! .../ikran-smoke-empty-1`**。

（如果 Roots 不可用，Agent 显式传路径：`create_or_open_project({ path: "~/ikran-smoke-empty-1" })`。）

确认 `~/ikran-smoke-empty-1/.ikran/` 现在含 `config.json`、`ikran.db`、`events.jsonl`。

### 4c. Agent 看到同一个 project/session（02/02 的核心主张）

让 Agent：

> 显示当前 Ikran 的 project/session.

预期：Agent 调用 `create_or_open_project({})` 并返回与 4b **相同**的项目路径 + session +
Workbench URL。这证明 MCP 工具与 Workbench HTTP API 操作在**同一个** project/session 上。

### 4d. Mismatch——Agent 必须 fail closed，不能静默切换

在第一个项目已激活时，让 Agent 绑定**第二个**文件夹：

> 为 `~/ikran-smoke-empty-2` create or open the Ikran project.

预期：`create_or_open_project({ path: ".../ikran-smoke-empty-2" })` 返回 `project_mismatch`
（ok=false, error="project_mismatch", active=...empty-1, expected=...empty-2）。它**不得**切换，
也**不得**创建 `~/ikran-smoke-empty-2/.ikran/`。记录 Agent 是干净地呈现了这个错误，还是当作 open
gap（issue 明确允许在失败时记录 open gap）。

> 注意：UI 里已经没有文件夹 picker 可以切换项目。要换项目，就用那个文件夹作为工作区重启 Ikran
> （MCP server 通过 Roots / `IKRAN_CWD` 重新发现它）；Agent 不能静默切换——单项目单流程。

### 4e. 刷新恢复绑定

在 `ikran-smoke-empty-1` 已绑定的情况下，在浏览器里重载 Workbench URL。确认 setup card 自动显示
**`Complete! .../ikran-smoke-empty-1`**——Runtime 在刷新后恢复了 project/session 状态（不重新
bind，不产生 event 噪音）。

### 4f. 通过 `setup_workspace` 做通用引导（Roots 不可用时，或为了按项目持久化）

如果 4a 显示 `source: "none"`（Cursor 不暴露 Roots），或者你想要一次性固定并且隔离并存项目，
就用这个通用工具。让 Agent：

> 为 Ikran 钉住这个工作区。/ call setup_workspace with the current folder.

预期：Agent 跑 `pwd`，调用 `setup_workspace({ path: "<pwd>" })`，拿到精确的 MCP 配置片段：

```json
{
  "mcpServers": {
    "ikran": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/bin/ikran-mcp.mjs", "--prod"],
      "cwd": "<pwd>",
      "env": { "IKRAN_HOST": "127.0.0.1", "IKRAN_STATE_DIR": "<pwd>/.ikran" }
    }
  }
}
```

然后 Agent **把这段写入** `<pwd>/.cursor/mcp.json`（合并进 `mcpServers`，保留其它 server；如果你
用别的方式调用 ikran，保留你的 `command`/`args`，只设 `cwd` + `env.IKRAN_STATE_DIR`），并告诉你
**重载 Cursor 的 MCP servers**。当前会话里，Agent 还会调用 `create_or_open_project({ path:
"<pwd>" })` 立即绑定。重载后，Ikran MCP server 以 `cwd = <pwd>` 和按项目独立的状态
（`IKRAN_STATE_DIR = <pwd>/.ikran`）启动，于是这个工作区以后的会话会自动发现 + 自动绑定
（resume）——不依赖 Roots、无需手动 `cwd`，且每个项目彼此隔离（独立状态 + Runtime）。

> `--prod` 需要 `npm run build`；零构建 dev 模式去掉 `--prod`。

## 5. 错误 token 检查（证明 session 约束覆盖了 project 接口）

在终端里，把 `<port>` 和 `<token>` 换成真实值（token 是 Workbench URL 里 `?session=` 的值）：

```bash
# 无 token -> 403（拒绝）：
curl -i -H "host: localhost:<port>" http://127.0.0.1:<port>/api/project

# 真 token -> 200（返回当前项目）：
curl -i -H "host: localhost:<port>" -H "x-ikran-session: <token>" http://127.0.0.1:<port>/api/project
```

预期前者 `403`，后者 `200`。

## 6. Codex Desktop

配置同样的 MCP 命令（Codex Desktop 的 MCP server 配置）。跑 4a–4d。如果 Codex **能发现**工具、
且（理想情况下）暴露 Roots → 记录成功。如果 Codex **不暴露/不能发现**工具（已知 gap：
`openai/codex#21019`、`#26659`、`#26072`）→ 这对 02/02 是**可接受的结果**（issue 说记录 open gap
+ fallback）。Fallback：打开 `npm start` 打印的 Workbench URL，点 **Project Folder** 那一行来
Initialize 工作文件夹（设计师点击路径不需要 MCP 工具），之后再确认 Agent 如果晚些发现工具，至
少能读 project/session。如果 Roots 没暴露但工具能用，让 Agent 显式传 `{ path }`。

## 7. 冒烟日志模板（填好后放在 `.plans/issue02-02/` 下）

```
日期：
工作文件夹发现：
  - list_working_folders() folder = ____  source = [ ] roots  [ ] env  [ ] none
  - 是你的研究文件夹（ikran-smoke-empty-1）吗？  [ ] 是  [ ] 否
  - 若否：Cursor 暴露 Roots？ [ ] 是 [ ] 否 → 用了哪个 fallback：[ ] IKRAN_CWD env  [ ] Agent 传 { path }  [ ] setup_workspace（写了 .cursor/mcp.json + 重载）
Workbench 启动方式： [ ] npm start (dev)  [ ] node bin/ikran.mjs --prod  [ ] 仅 Agent 的 open_workbench

Cursor：
  - open_workbench 返回了 URL？  [ ] 是  [ ] 否（Agent 说没有工具）
  - URL host:port：
  - 内嵌浏览器打开了 shell？显示 "Local runtime connected"？  [ ] 是  [ ] n/a
  - 文件夹步骤显示了工作文件夹（Project Folder 行）？  [ ] 是  [ ] 否
  - 一键 Initialize（设计师点击）在工作文件夹里创建了 .ikran？  [ ] 是  [ ] n/a（用 Agent 绑定）
  - create_or_open_project({})（不带 path）绑定了发现的文件夹？
      [ ] 是（项目路径 = ____ ）  [ ] n/a（用了 { path }）  [ ] 否（错误：____）
  - .ikran/ 已创建（config.json + ikran.db + events.jsonl）？  [ ] 是  [ ] 否
  - create_or_open_project({}) 返回了相同的 project/session？  [ ] 是  [ ] 否
  - create_or_open_project({ path: empty-2 }) -> project_mismatch（未切换）？  [ ] 是  [ ] 否（切换了——bug）
  - empty-2/.ikran 未被创建？  [ ] 是  [ ] 否（创建了——bug）
  - 刷新恢复了绑定文件夹（Complete!，未重新 bind）？  [ ] 是  [ ] 否
  - setup_workspace({ path: pwd }) 返回了 cwd + IKRAN_STATE_DIR 片段？  [ ] 是  [ ] n/a
  - Agent 写了 .cursor/mcp.json + 重载 → 以后会话在此自动绑定？  [ ] 是  [ ] n/a
  - 错误 token curl /api/project -> 403？  [ ] 是 ；真 token -> 200？  [ ] 是
  - Agent 是干净地呈现了 project_mismatch，还是当作 open gap？  ____

Codex Desktop：
  - 工具被发现？  [ ] 是  [ ] 否 → open gap：____ ；用了哪个 fallback：____
  - Roots 被暴露？  [ ] 是  [ ] 否 → 用了哪个 fallback：____

备注 / open gaps：
```

## 8. Workbench URL 仅限 localhost——使用须知

- URL 与 session token 是**仅本地**且**随启动而定**的（Runtime 进程退出即失效）。**不要**转发
  到远端主机、贴进共享文档，或当作可分享的公开链接。
- 绑定一个文件夹只会在该文件夹里创建 `.ikran/`（与已有文件并存），不会改动你的其它文件。
- 单项目单流程：Agent 不能通过 `create_or_open_project` 静默切换项目（mismatch 时 fail
  closed），Workbench UI 也没有文件夹 picker 了。要换项目，就用新文件夹作为工作区重启 Ikran
  （通过 Roots / `IKRAN_CWD` 重新发现）。

## 实现侧已完成的验证（所以你可以专注在 Agent 路径上）

- `npm run typecheck` 通过。
- `npx playwright test`（全量）通过：MCP 工具创建 `.ikran/`（config + SQLite + events.jsonl），
  记录 `project_created` + `folder_selected`，幂等 open，mismatch 时 fail closed（且不为被拒
  文件夹创建 `.ikran/`），跟随 HTTP 侧切换，拒绝无 token 请求（403），并在刷新后恢复绑定。
  **基于 Roots 的发现**已覆盖：声明 `roots` 并响应 `roots/list` 的客户端 →
  `create_or_open_project({})` 绑定该 root，`list_working_folders` 报告 `source: "roots"`；
  无 roots 的客户端 → `no_working_folder` + `source: "none"`。**`setup_workspace`**已覆盖：它
  返回按项目的配置片段（`cwd` + `env.IKRAN_STATE_DIR = <path>/.ikran`）且**不写文件**。UI 一键
  Initialize（init + manual cwd）与 auto-resume 由 `cwd-auto-bind.spec.ts` 覆盖；shell 渲染新的
  `Project Folder` 标签（`ikran-runtime-health.spec.ts`）。其余套件无回归。