# ADR 0001：转向 Agent 桌面端融合（传统 MCP + HTTP Web UI + tldraw），退役独立本地 app + 无头 CLI 路径

**Status:** accepted（2026-07-07）

> **Superseded in part by [ADR 0002](./0002-consolidate-runtime-and-research-records.md)（2026-07-10）。**
> 本 ADR 的产品转向（Agent host + 传统 MCP + HTTP Workbench + tldraw、退役无头 CLI）仍然有效。
> 下列**实现细节**已被 ADR 0002 收口替代，阅读时勿当作当前 Active 契约：两进程 coordinator 作为目标拓扑、MCP 经 HTTP loopback、保留 mock AgentAdapter / task lifecycle 作为产品路径、Workbench 双入口 seed、`create_evidence_surface` 独立工具、JSONL 与 SQLite 双写事实源表述、以及「一进程两表面仍是 follow-up」等后续工作项表述。
> 下文保留为历史决策原文，不改写为仿佛当时已是当前架构。

## 背景 / 动机

PRD 原方案是 `npx ikran` 开自己浏览器的独立本地 app，Runtime spawn 无头 CLI Agent（Codex/Cursor/Claude）。2026-07-06 的真实接入 smoke（`.plans/issue04/REAL_AGENT_SMOKE.md`）证明这条路作为产品太重：无头 CLI 要逐 agent 配 Figma MCP config + token + 权限 + 视觉模型；`agent` 挂起、`claude -p` 要交互授权或撞 "model does not support image input"、`agent --yolo` 诚实 blocked。本质是"看起来依赖更小、实则仍依附于其他 Agent，且集成费力不讨好"。

目标：把沉重的 Figma-MCP / 模型 / 工具 / 权限集成**转移到 Agent 宿主**（它本来就有），Ikran 只做它擅长的——画布、语义记录、事件、preview、校验。

## 决策

Ikran 以**融合**形态存在：一个本地 Runtime daemon，既是**传统 MCP server（stdio，给 Agent 工具）**，又是**HTTP Web UI（Workbench，给设计师打开）**。Workbench 可在任意浏览器打开，理想环境是 Agent 桌面端嵌入式浏览器，这样宿主 chat、MCP tool、文件编辑和空间画布都在同一个工作环境内。目标宿主 **Cursor + Codex 桌面端**。画布底座 **tldraw**。

核心子决策：

- **Agent ↔ Runtime** = 传统 MCP（stdio，语义 tools）；Agent 不直接操作画布。
- **设计师 ↔ Runtime** = Web UI（HTTP REST + SSE），可在任意浏览器打开；优先推荐 Agent 桌面端嵌入式浏览器。
- **事实源**：Runtime 语义记录为事实源；tldraw 几何非事实源；靠 `record-id` 关联；语义变更经 tool + Issue 13 校验。
- **Agent 操作画布** = 纯语义 MCP tools（无 raw exec、无单独几何工具）；几何作可选参数 + `update_record_geometry`。
- **文件写入**：Agent 经宿主原生编辑写源文件；只有经 `record_artifact_written` 声明并通过 Runtime 校验的 source artifact 才进入研究记录、派生 artifact 和导出。
- **Figma 接触面**：Ikran 零 Figma 接触；Figma 摄取完全在 Agent 宿主的 Figma MCP；Runtime 逐字存 seed URL + 校验 Agent 返回 package。
- **DOM inspection**：MVP 内做可用版，经 Runtime preview 代理注入脚本 + postMessage。
- **transport**：MCP = stdio（宿主 spawn Runtime）；Runtime 另起 HTTP Web UI（localhost 自动端口 + 启动级 session token）。一进程两表面。
- **UI chrome**：Web UI = 画布 + stage tabs + 左 question 面板 + 答题卡（卡上输入最终答案）；无右 chat 面板（宿主 chat 即 chat）。

### 启动与会话协议

设计师通过自然语言让 Agent 打开 Ikran。Agent 调用 Ikran MCP tool 启动或复用 Runtime HTTP surface，Runtime 绑定 `127.0.0.1` 自动端口，生成启动级 session token，并返回 Workbench URL，例如：

```text
http://127.0.0.1:{port}/?session={token}
```

Agent 把这个 URL 用自然语言返回给设计师。设计师可以把它打开在任意浏览器；理想路径是在 Agent host 的嵌入式浏览器中打开。这样 Codex/Cursor chat 仍承担多轮澄清和指令沟通，Workbench 承担画布、问题卡、最终答案、preview 和结构化状态。

会话边界：

- Runtime 只绑定 localhost，不开放宽泛 CORS。
- session token 随 Runtime 启动生成，关闭 Runtime 后失效。
- MCP tools 与 Workbench HTTP API 共享同一个 project/session 上下文；Runtime 为所有语义记录分配 ID。
- 如果宿主嵌入式浏览器不可用，复制到系统浏览器是正式降级路径，不改变 Runtime 安全模型。
- Workbench URL 不是公开 URL，不支持远程协作或跨设备访问。

### 最小 MCP 工具面

MVP 的 MCP 工具只表达语义 intent，不提供 raw exec，不提供单独几何操作。最小工具面：

1. `open_workbench`：启动或复用 Runtime HTTP surface，返回 Workbench URL。
2. `create_or_open_project`：绑定单项目工作区和 `.ikran` 状态。
3. `register_seed_reference`：记录 Figma seed URL 和原始设计意图；Runtime 不接触 Figma。
4. `record_evidence_package`：Agent 用宿主 Figma MCP 摄取后声明 evidence package。
5. `create_evidence_surface`：创建 Figma 或 Prototype Evidence Surface 的语义记录。
6. `create_region_annotation`：创建锚定到 Evidence Surface 的 Region Annotation。
7. `create_question_card`：创建带观察、问题、anchor 和阶段信息的问题卡。
8. `record_designer_answer`：记录卡片上的最终设计师答案。
9. `record_artifact_written`：Agent 写 source artifact 后声明路径、类型、语义目的和关联记录。
10. `record_preview`：声明或更新 prototype preview/run 与对应 Evidence Surface。
11. `propose_rule_update`：记录规则更新提案，等待设计师确认。
12. `export_research_package`：生成研究导出。

几何只作为语义记录的可选 display hint 或由 tldraw 管理；几何不进入研究事实源。

### 文件与校验边界

Agent 可以用宿主原生文件编辑能力写 prototype code、design-system markdown、`token.json` 和 component specs。Runtime 不代理这些源文件写入。

但 Ikran 的事实源只承认已声明 artifact：

- 已声明且校验通过：进入事件日志、artifact index、derived artifact 生成和研究导出。
- 已写入但未声明：最多作为未声明变更 warning/open gap，不自动进入事实源。
- 声明后校验失败：记录 invalid-output/invalid-artifact 事件；Runtime 可请求一次修复；修复仍失败时不补造语义。

校验分三类处理：

1. semantic record schema：问题卡、标注、evidence package、rule proposal 等 MCP tool payload，沿用 Issue 13 的一次修复原则。
2. design-system artifact：`token.json`、design-system source、view JSON 等，Runtime 校验结构并生成 derived artifact。
3. prototype/code artifact：Runtime 通过 build/preview readiness/DOM inspection 等确定性检查记录状态；不把代码质量判断伪装成语义事实。

## 为什么

- 把 Figma-MCP / 模型 / 工具 / 权限集成交给 Agent 宿主（它已具备），消灭逐 CLI 配环境的税——这正是 smoke 失败的根因。
- 传统 MCP + HTTP Web UI **不依赖 MCP Apps 内联 UI**，所以不被 MCP App 宿主渲染能力绑定（MCP Apps 在 Codex 桌面端还不渲染，`openai/codex#21019`）。Codex 桌面端 MCP tool 暴露仍需 smoke 验证；Cursor 可作为先行宿主。
- 保留大部分已有 Runtime 工作（UI / API / SSE / 事件 / 校验 / 项目绑定）；只退役无头 CLI 集成层 + Figma validate + React Flow 画布层。
- tldraw 在新模型下仍占优：原生 iframe embed（每个原型都是 live 可交互 iframe）+ 标注 custom shape（标注驱动的对齐是工具心脏）；PRD 已把工作流 graph 降权为非事实源 layout。

## 被否决的替代

1. **独立 `npx ikran` + Runtime spawn 无头 CLI Agent**（原 PRD）：逐 agent 配 Figma MCP/token/权限/视觉模型太重；smoke 已证 block。
2. **MCP App 内联 UI**（tldraw `apps/mcp-app` 模型）：绑 MCP App 宿主支持（Cursor 行、Codex 桌面端不行 `#21019`）；画布塞在 chat 内联视口受限；退役更多已有 UI。我们最初设计向此，后因明确"用宿主嵌入式浏览器开 HTTP Web UI"而转为传统 MCP + HTTP Web UI。
3. **Runtime 代理写文件（写前置门）**：重复宿主原生文件编辑、DX 差；改用 agent 经宿主直写 + 声明 + 后置校验。
4. **tldraw shape-store-as-source / raw exec**：破 Issue 13（Runtime 无法在接受前校验 intent）；改用 Runtime 记录为事实源 + 纯语义 tools。
5. **React Flow 画布**：新模型下 tldraw 的 MCP-App/exec 优势失效，但 tldraw 仍因 R4（iframe embed）+ R6/R7（标注 custom shape）胜出；React Flow 现在是**可辩护的未来选项**（若工作流 graph 需求变大可复议）。
6. **本地 HTTP MCP transport**：重新带回端口/token/CORS + 第二进程；stdio 更轻，且记录无论如何持久化在 SQLite。

## PRD 修订

**修订：**
1. 产品形态：`npx ikran` 开自己浏览器 / Runtime spawn Agent → Agent host 通过 MCP（stdio）启动 Runtime，Runtime 返回 Workbench URL；Workbench 可在任意浏览器打开，理想环境是 Agent 桌面端嵌入式浏览器。
2. 画布底座：React Flow → tldraw。
3. 文件访问：Runtime owns source file access → Agent 经宿主直写 source artifact + 必须声明；Runtime 只承认声明并校验过的 artifact，负责派生 artifact + 事件/校验/preview；Workbench 仍不碰文件。
4. Figma 接触面：Runtime 做 Figma 校验/摄取 → Ikran 零 Figma 接触（强化"Figma MCP 在 agent 环境"）。
5. 四区 UI：右 Agent sidebar = 宿主 chat；Web UI = 画布 + stage tabs + 左 question 面板 + 答题卡（卡上输入最终答案）。
6. Agent 操作：headless CLI 为产品路径 → 语义 MCP tools（无 raw exec）。
7. 事件观察：同源 SSE 推送 → HTTP REST + SSE（Workbench）+ MCP tool（Agent）+ declare + preview。
8. 画布事实源：明确 Runtime 语义记录为源、tldraw 几何非源。
9. DOM inspection：延后 → MVP 内做可用版。
10. transport：同源 `/api` + session token → stdio MCP + HTTP Web UI 两表面；Workbench URL 内带启动级 token。

**保持：** Figma MCP 留 agent 环境（强化）；region annotation 一等记录 + Runtime 校验 + 一次修复（Issue 13，强化）；preview runtime（iframe embed，用 tldraw embed shape）；研究事件 + 导出（Issue 12）；单项目单流程 / 本地优先 / 一个月研究原型；Agent 负责设计推理与原型创建、Runtime 确定性；`token.json` 事实源 + Tailwind 派生 + 原型栈 Next.js/TS/Tailwind/npm；递归设计法阶段顺序。

## 后果与后续

**退役：** `agent-profiles.ts`、cli-adapter 心跳、`dev-real-seed.mjs`、`real-seed-evidence-agent-wrapper.mjs`、`app/api/figma/validate` + `parseFigmaReference`、React Flow 画布层。Issue 14（hardened headless CLI）作为产品路径作废；fake/mock adapter 的测试价值保留。Issue 16 的 headless CLI smoke 半边作废，改成真实 Agent host MCP smoke。

**保留：** Next.js UI + `/api/*` + SSE + session token + mock adapter + task lifecycle + schema + events + 项目绑定 / `.ikran` / SQLite + Enter Panel + task hook。

**测试：** Playwright e2e（Next.js UI 在，回来）+ MCP 边界（mock MCP client 打 tool handlers）+ 手动桌面 smoke（真在 Cursor/Codex 桌面端跑一遍）。

最小 smoke：

1. Cursor/Codex 能发现 Ikran MCP tools，并通过 `open_workbench` 返回 localhost Workbench URL。
2. Workbench URL 在 Agent host 嵌入式浏览器可打开；复制到系统浏览器也可打开。
3. 错误或缺失 session token 会被拒绝。
4. Agent 可用宿主 Figma MCP 取得 seed evidence，并通过 Ikran tool 声明；Runtime 不接触 Figma。
5. Agent 写 source artifact 后声明，Runtime 记录事件、校验并生成派生 artifact。
6. 未声明 source artifact 不进入 research export。
7. tldraw Evidence Surface 可渲染 live iframe preview，Region Annotation 坐标可回连 semantic record。

**后续工作项：**
1. tldraw 自定义 embed/shape 放宽 sandbox + preview 代理注入中间件 + inspection 脚本（DOM inspection 可用版）。
2. Runtime 一进程两表面（stdio MCP + HTTP Web UI 自动端口 + 启动级 session token + `open_workbench` 返回 URL）。
3. Cursor 先行 smoke；Codex 桌面端 MCP 工具暴露 bug（`openai/codex#26659` / `#26072`）观察并记录 fallback。
4. Agent 写源文件的 skill 编排（递归设计法各步用哪些 Figma MCP / Ikran tool / 文件编辑 / `record_artifact_written` 声明）。
5. 把本 ADR 的 PRD 修订回写进 `IKRAN-MVP-PRD.zh-CN.md` 与 `issues/`（标记 14/16 headless 半边作废、04 画布层换 tldraw、启动协议换成 Workbench URL）。

调研产物归档：`.plans/issue04/REAL_AGENT_SMOKE.md` + smoke 日志留作本 ADR 动机证据，不删。

## 参考

- `.plans/issue04/REAL_AGENT_SMOKE.md`（无头 CLI smoke 失败记录）
- `CONTEXT.md`（术语表）
- `IKRAN-MVP-PRD.zh-CN.md`、`issues/`（被修订 / 保持的 PRD 决策来源）
- MCP Apps 规范：`modelcontextprotocol.io/extensions/apps`
- tldraw SDK + `apps/mcp-app`（widget 渲染参考，不继承 exec/shape-store）
- Codex MCP 支持：`developers.openai.com/codex/mcp`；`openai/codex#21019`（桌面端不渲染 MCP App 内联 UI）
