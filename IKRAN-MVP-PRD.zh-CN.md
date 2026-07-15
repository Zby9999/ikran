# Ikran MVP PRD（中文）

状态：ready-for-agent
目标：一个月内可用的研究原型
日期：2026-07-12
标准：本文是 Ikran MVP 的唯一产品标准；issues 应只依赖本文。

## Problem Statement

使用 agentic 设计工作流的设计师已经可以让编码 Agent 产出原型，但交互仍然过于依赖聊天文本，也过于脱离设计画布。当 Agent 不理解一个或多个表达同一设计语言的 Figma Seed References 时，设计师必须从聊天线程中推断 Agent 到底困惑在哪里。这会让设计意图对齐变慢、难以审计，也难以沉淀成持久的设计系统。

现有的 Recursive Design Method 已经定义了正确工作流：从设计师认为重要的 Figma Seed References 开始，对齐共享的设计语言，提取一个设计师和 Agent 都能阅读的设计系统，将种子重建为交互式原型以验证代码、视觉和语义一致性，然后使用生成的设计系统创建新原型，并递归更新规则。现在缺少的是一个本地优先、空间化、可记录研究数据的 Ikran workbench。

原 PRD 计划让 Ikran Runtime 自己 spawn headless CLI Agent。真实 smoke 显示这条产品路径太重：每个 CLI Agent 都要单独配置 Figma MCP、权限、视觉模型和交互授权，且很难稳定返回 schema-valid output。后续 Agent-host-only Figma ingestion 又暴露了另一项体验问题：设计师粘贴 Figma link 后，如果没有活跃 Agent 完成截图与声明，Workbench 就无法立即显示可标注的视觉证据。Ikran 不应复制 Agent host 的模型和实现级设计推理，但 Runtime 必须能确定性地摄取低语义的 Figma positional evidence。

MVP 必须在一个月内成为完整闭环的研究原型。它必须支持：

- 安装级只读 Figma Connection（MVP 使用 Personal Access Token；OAuth 为 Future Work）。
- Figma Connection Gate：未连接时显示连接面板并锁定画布。
- 设计师粘贴或 Agent 经语义 tool 添加任意数量的 Seed References；Runtime 立即、原子地摄取截图与位置证据。
- 项目级 Design Language Description 与每条 Seed Reference 的可选 Reference Note。
- Agent host 使用自己的 Figma MCP 按需读取实现级 Figma context。
- Ikran Runtime 记录 canvas record、事件、校验和派生 artifact。
- Ikran workbench 提供 tldraw 空间画布、Evidence Surface、Region Annotation、Question card 和 preview。
- 设计系统 source artifact 和 prototype code 保存在项目文件夹内。
- 新原型创建和规则递归。
- 研究导出：仅完整成功递归项目**有资格**导出；达标后导出整条成功语义链路（含闭环前阶段）（JSON/JSONL derived export）。

产品在第一个月不能变成完整 IDE、Figma 替代品、MCP App 内联 UI、通用白板、云端协作平台，或通用 AI App 生成器。它应该是一个单项目、单流程的本地研究 workbench，用于递归式设计师-Agent 对齐。

## Solution

Ikran 以融合形态存在：一个本地 Ikran Runtime **一进程**同时提供两个 surface：

- Agent ↔ Runtime：Agent host spawn 短生命周期 stdio bridge；bridge 只转发 JSON-RPC，按需启动并连接持久本地 Runtime。语义 MCP server 与 Workbench 仍在同一个 Runtime 进程内。
- Designer ↔ Runtime：HTTP Web UI（custom Next HTTP/SSE），即 Ikran workbench。Runtime 绑定 `127.0.0.1` 自动端口，生成启动级 session token，并返回 Workbench URL。

语义 MCP server 与 HTTP/SSE 运行在同一 Node Runtime 进程内，共享同一 command kernel；stdio bridge 不包含语义 tool implementation，也不经 localhost HTTP loopback。单次 Agent-host transport 断开只释放 MCP lease，不关闭 Runtime 或 Workbench；Runtime 由 Workbench Shutdown、`ikran stop` 或零 lease idle timeout 结束。

设计师通过自然语言让 Agent 打开 Ikran。Agent 调用 `open_workbench`，Runtime 启动或复用 HTTP surface，并返回类似下面的 URL：

```text
http://127.0.0.1:{port}/?session={token}
```

Agent 把 Workbench URL 返回给设计师。设计师可以在任意浏览器打开它；理想环境是 Agent host 的嵌入式浏览器，因为 chat、MCP tool、宿主文件编辑和空间 workbench 会处在同一工作环境内。

**Figma Connection Gate：** Workbench canvas 只有在安装级 Figma Connection 已连接并验证后才可用。未连接时显示设计师提供的 Figma Connection Panel 并锁定画布；在锁定画布中粘贴 Figma link 会明确报错，不创建 pending Seed Reference。

**Seed Reference 双 initiator、单 command：** 设计师可直接在 Workbench 画布粘贴 Figma selection link，Agent 也可通过语义 MCP tool 添加 Seed Reference；两条入口共享同一 Runtime command、canonical identity 和原子提交边界。项目可包含任意数量、共同表达同一种设计语言的 Seed References；canonical `file_key` + normalized `node_id` 相同的重复提交只复用并聚焦已有 Frame。

Ikran workbench 提供：

- tldraw 画布。
- stage tabs。
- 左侧 question list。
- Question card（可含 Agent `proposed_answer`；设计师填写或接受后形成 final answer）。
- Figma Evidence Surface。
- Prototype Evidence Surface，使用 live iframe preview。
- Region Annotation custom shape。
- 设计系统浏览器。
- 规则更新提案确认流。
- 最小研究导出操作。

Agent host 的 chat pane 保留为多轮澄清、指令沟通和 Agent 解释空间。Ikran workbench 不再提供右侧通用 chat 面板。

Ikran Runtime 负责：

- MCP tool handlers（与 HTTP 共享 command kernel）。
- HTTP REST API 和 SSE。
- Workbench URL 与启动级 session token。
- Figma Connection Gate、安装级凭证访问和连接状态。
- Figma REST API positional-evidence adapter。
- Seed Reference 原子摄取、截图、位置索引、显式 refresh 和 evidence lineage。
- 项目绑定和 `.ikran/` 元数据。
- SQLite 状态与 **canonical** 事件存储（record + event 同事务）。
- JSONL event log 作为可重建的 **derived export**。
- canvas record 校验、ID 分配、持久化和广播。
- source artifact declaration 校验。
- derived artifact 生成。
- prototype preview lifecycle。
- DOM inspection 可用版。
- 研究导出（入选：完整成功递归；内容：整条成功语义链路，含闭环前阶段）。

Agent host 负责：

- 模型推理。
- 通过 Figma MCP 按需读取实现级 Figma context。
- 设计解释。
- 问题和标注提出。
- design-system source artifact 写入。
- prototype code 写入。
- rule update proposal 生成。
- 通过 Ikran MCP tools declare 语义结果。

Ikran Runtime 通过 Figma Connection 直接访问 Figma REST API，但仅捕获 positional evidence：截图、canonical source identity，以及将 Region Annotation 定位到候选 source nodes 所需的最低 node identity/name/type/bounds 数据。Runtime 不预取布局、样式、组件、变量等实现级 context；Agent 需要这些信息时，根据 Seed Reference 或 Runtime 排序出的 node candidates 自主调用宿主 Figma MCP。

## Product Standard

本文是实现、拆 issue、验收和研究 smoke 的唯一标准。任何 issue、agent handoff 或实现计划都不应要求读取其他设计记录才能知道产品边界。其他设计记录只保留为历史背景；若其他设计记录与本文冲突，以本文为准。

历史 ADR / Issues 完成报告保留原文；实现细节若被后续架构收口替代，以本文、`docs/adr/0002-consolidate-runtime-and-research-records.md` 与 `docs/adr/0003-runtime-owned-figma-positional-evidence.md` 为准。

Ikran 的核心不变量：

1. Runtime-owned semantic records 是研究事实源。
2. tldraw geometry 不是事实源，也不是研究数据。
3. Agent host 负责模型、实现级 Figma MCP context、工具审批和源文件编辑。
4. Ikran Runtime 负责 MCP tools、Workbench、Figma positional evidence、记录、校验、preview、derived artifacts 和 export。
5. Runtime 的 Figma 接触只限于安装级 Figma Connection 与确定性 positional-evidence capture；实现级 context 留在 Agent host 的 Figma MCP。
6. Source artifact 只有声明并校验通过后才进入事件、artifact index、derived artifact 和 export。
7. Workbench 是空间化结构表面，不是 chat，也不是通用白板。
8. Seed Reference 支持 Workbench paste 与 Agent tool 双 initiator，但共享同一 Runtime command、canonical identity 和原子提交边界。
9. SQLite events 为 canonical；JSONL 为可重建 derived export。失败请求、草稿、取消与 Open Gap 可留在运维/调试路径，但不进入研究事实导出。

### 为什么采用 Agent Host + MCP + Workbench URL

原 headless CLI 路径看起来让 Ikran 更独立，但真实接入暴露出逐 Agent 集成税：Figma MCP config、token、权限、视觉模型、交互授权和 schema-valid output 都要为每个 CLI Agent 单独处理。Ikran 本质仍依赖其他 Agent，却承担了宿主本来已经拥有的模型和工具集成复杂度。

新的产品形态把模型、实现级 Figma MCP context、工具审批和文件编辑能力交给 Agent host；Runtime 只承担可确定、低语义的 Figma positional-evidence capture。这样既避免复制 Agent 的推理能力，也避免设计师等待活跃 Agent 才能看到 Figma 截图。Ikran 继续专注于画布、semantic records、事件、preview、校验和研究导出。

传统 MCP + HTTP Workbench 不依赖 MCP Apps inline UI，因此不会被宿主是否支持 MCP App 渲染卡住。Cursor 可作为优先真实 host；Codex Desktop 的 MCP tool 暴露能力需要持续 smoke，如果受宿主 bug 影响，记录 open gap 和 fallback。

### 被否决的产品路径

- 独立 `npx ikran` 打开自己浏览器并由 Runtime spawn headless CLI Agent：逐 Agent 配 Figma MCP、token、权限和视觉模型太重，作为 MVP 产品路径废弃。
- MCP Apps inline UI：依赖宿主渲染支持，且 chat 内联视口不适合承载 Ikran 的空间画布。
- Runtime 代理 source artifact 写入：重复 Agent host 原生文件编辑能力，DX 差；改为 Agent host 写源文件、Runtime 接受声明并校验。
- tldraw shape-store-as-source 或 raw exec：会绕过 Runtime 接受前校验，破坏研究事实源。
- React Flow 作为 MVP 画布底座：React Flow 仍可作为未来工作流 graph 需求变强时的备选，但 MVP 采用 tldraw，因为 Evidence Surface、live iframe preview 和 custom annotation shape 是核心。
- HTTP MCP transport：会重新引入端口/token/CORS 和第二进程问题；MVP 采用 stdio MCP + localhost HTTP Workbench 两 surface（同一进程）。
- Agent-host-only Figma ingestion：无法保证粘贴后立即可视；改为 Runtime capture positional evidence，Agent MCP 按需读取 implementation context。
- Runtime 预取完整 Figma implementation context：存储、限流、隐私和上下文成本过高，且模糊 Runtime 确定性与 Agent 推理边界。
- Figma capture 失败后保留 pending/failed Seed Reference：会形成半成品画布对象；改为 Connection Gate + 成功后原子提交。
- MVP 直接实现 Figma OAuth：正式产品体验更好，但 app review、callback、client secret/token broker 和 refresh 生命周期扩大当前范围；MVP 使用 PAT，OAuth 留作 Future Work。
- AgentAdapter、`/api/tasks`、fake Agent connection、mock product families：已否决为产品路径；测试仅保留 deterministic MCP client / test doubles。

### 迁移后果

需要退役或不再作为产品路径推进：

- headless CLI AgentAdapter 产品路径。
- AgentAdapter 接口、`/api/tasks`、fake Agent connection、mock product families。
- hardened headless CLI issue 路径。
- real headless CLI Figma smoke 作为最终验证路径。
- Runtime 旧 Figma validate/oEmbed 路径以及 Agent-supplied evidence ingestion。
- React Flow seed/evidence canvas layer。
- raw geometry tool 或 shape-store-as-source 模型。
- `list_pending_seed_evidence` 与 Agent-supplied `record_evidence_package` Active 工具路径。
- 冗余 `create_evidence_surface` MCP tool（Figma surface 由 Runtime seed capture 创建；Prototype surface 由未来 `record_preview` 创建）。
- 两进程 coordinator + MCP HTTP loopback 作为目标拓扑（已由一进程 + direct command kernel 收口）。

需要保留并迁移：

- Next.js Workbench（custom server 同进程托管）。
- HTTP REST API 和 SSE。
- session token。
- project binding 和 `.ikran`。
- SQLite（canonical events）、derived JSONL export、schema validation。
- deterministic MCP client / test doubles（仅测试）。
- setup / Folder chrome 中仍符合 Figma 参考的 UI 部分。
- Runtime-owned Seed Reference command、canonical identity、append-only Evidence lineage 与 tldraw projection。

## User Stories

1. 作为设计师，我想通过自然语言让 Agent 打开 Ikran，以便我不需要理解 Runtime 启动细节。
2. 作为设计师，我想让 Agent 返回一个 Workbench URL，以便我可以直接进入 Ikran workbench。
3. 作为设计师，我想在 Agent host 的嵌入式浏览器中打开 Workbench URL，以便 chat、文件编辑和画布保持在同一个工作环境内。
4. 作为设计师，我想在普通系统浏览器中也能打开 Workbench URL，以便嵌入式浏览器不可用时仍可工作。
5. 作为设计师，我想连接一次 Figma Personal Access Token 并跨本地项目复用，以便后续粘贴无需等待 Agent 或重复配置。
6. 作为设计师，我想在 Figma Connection 未就绪时看到连接面板且画布锁定，以便先解决必要权限而不是产生无截图的半成品。
7. 作为设计师，我想直接在画布粘贴任意数量的 Figma selection links，以便把所有重要的同语言参考立即带进 Ikran。
8. 作为设计师，我想让同一 `fileKey/nodeId` 的重复链接只复用并聚焦一个 Frame，以便画布不会出现重复 Seed Reference。
9. 作为设计师，我想在粘贴后由 Runtime 自动获取截图和位置证据，以便没有活跃 Agent 时也能立即看到可标注的 Figma Evidence Surface。
10. 作为设计师，我想只填写一次项目级 Design Language Description，以便多个 Seed References 共享同一种设计语言说明。
11. 作为设计师，我想为单个 Seed Reference 可选追加 Reference Note，以便说明它为何重要或展示了哪一方面。
12. 作为设计师，我想让 Agent 也能把重要 Figma node 添加回同一画布，以便 Agent 与画布之间可以双向流转。
13. 作为设计师，我想显式 Refresh 一个 Seed Reference，以便在同一 lineage 中查看新 Figma 版本并保留历史标注。
14. 作为设计师，我想看到 Figma Evidence Surface，以便在视觉上下文中理解 Agent 的观察和问题。
15. 作为设计师，我想让种子对齐按 Design principle、Visual language、Token、Layout、Component 和 Interaction 六部分进行，以便覆盖对设计结果影响最大的意图维度。
16. 作为设计师，我想让每个阶段包含二到五张 Question card，以便流程有足够深度但不过载。
17. 作为设计师，我想让所有 Question card 都必须有非空 final answer，以便 seed extraction 没有遗漏的对齐维度；空问题与空答案被拒绝，可填“同意/对”。
18. 作为设计师，我想在 Question card 上看到 Agent `proposed_answer` 并输入或接受最终答案，以便研究数据有明确的设计师结论与 answer source。
19. 作为设计师，我想在 Agent host chat 中进行开放澄清，以便复杂讨论不挤进卡片 UI。
20. 作为设计师，我想让 Question card 记录 Agent observation、Agent question、conversation thread、proposed answer、final answer 与 answer source，以便后续能审计对齐过程。
21. 作为设计师，我想选择 Question card 时自动聚焦对应证据锚点，以便我在视觉上下文中回答。
22. 作为设计师，我想让 Figma Evidence Surface 在种子提取完成后可以隐藏和重新显示，以便工作区不会长期被历史证据占满。
23. 作为设计师，我想在种子提取后查看设计系统浏览器，以便理解 Agent 提取出的设计语言。
24. 作为设计师，我想让设计系统浏览器展示 Foundations 和 Components，以便它像设计系统而不是文件查看器。
25. 作为设计师，我想查看 Color、Typography、Materials、Layout 和 Interaction 页面，以便规则被放在所属语义位置。
26. 作为设计师，我不想要单独的 Rules 页面，以便规则不会脱离 foundations 和 components。
27. 作为设计师，我想查看 component inventory 和 component detail，以便提取出的组件可审查。
28. 作为设计师，我想让 foundation 页面包含语义角色、视觉样例和简短用法说明，以便系统容易阅读。
29. 作为设计师，我想让 component detail 展示目的、变体、状态、token 链接和示例，以便判断组件是否可复用。
30. 作为设计师，我想让设计系统 source artifact 保持为 Markdown 和 JSON，以便人和 Agent 都能阅读。
31. 作为设计师，我想让 Workbench 读取 derived `design-system-view.json`，以便 UI 渲染稳定而不解析 Markdown 表格。
32. 作为设计师，我想让 `token.json` 成为设计 token 事实源，以便 Tailwind 只是实现映射。
33. 作为设计师，我想让 Agent 将 seed page 重建为真实 prototype，以便验证设计系统、代码和视觉输出是否一致。
34. 作为设计师，我想在 Prototype Evidence Surface 中看到 live iframe preview，以便我审查真实交互而不是截图。
35. 作为设计师，我想让 preview 随 Agent 修改代码更新，以便 Ikran workbench 像实时设计空间。
36. 作为设计师，我想用 focus mode 打开本地 preview URL，以便完整体验交互。
37. 作为设计师，我想在 prototype 上选择区域并创建 Region Annotation，以便将反馈精确绑定到运行中的界面。
38. 作为设计师，我想让 prototype region selection 产生 bounding box、normalized rect、selected crop 和可用 DOM candidates，以便 Agent 能更准确地修复。
39. 作为设计师，我想在初始设计系统存在后，从人类意图创建新原型，以便测试设计语言是否可泛化。
40. 作为设计师，我想可选提供 visual reference，以便纯意图不足时补充布局参考。
41. 作为设计师，我想让新原型创建消费当前设计系统，以便输出不是只靠 prompt memory。
42. 作为设计师，我想对新原型的整体或局部区域反馈，以便设计系统能通过真实使用成长。
43. 作为设计师，我想让 Agent 将反馈分类为局部例外、可复用候选、规则冲突、开放缺口、拟议更新或未发现，以便设计系统不被污染。
44. 作为设计师，我想在设计系统变更前看到 rule update proposal，以便我是最终决策者。
45. 作为设计师，我想确认或取消 rule update proposal，以便没有设计系统变更被静默应用。
46. 作为研究者，我想记录 project creation、Seed Reference initiator、successful positional-evidence capture、annotation、question、answer、preview、prototype run、feedback、proposal 和 export 等语义事件，以便分析设计意图如何协商。
47. 作为研究者，我不想记录每次 pan、zoom、hover 或文本击键，以便数据聚焦语义对齐而不是 UI 噪声。
48. 作为研究者，我想让 prototype run 和 rule update 链接回相关 question、answer、design-system version 和 Region Annotation，以便研究输出可追溯。
49. 作为研究者，我想导出 JSON/JSONL 包，以便在 Ikran 外分析实验数据；仅完整成功递归项目有资格导出，且导出须含该项目整条成功语义链路（含闭环完成前的阶段）。
50. 作为研究者，我想让未声明 source artifact、失败请求、失败标注、草稿、取消、Open Gap 与 canvas layout 不进入研究导出，以便导出只含成功研究事实。
51. 作为实现者，我想让 Runtime 同一进程提供 MCP stdio surface 和 HTTP Workbench surface，以便一进程承担两条交互路径并共享 command kernel。
52. 作为实现者，我想让 Runtime 只绑定 localhost 并用启动级 session token 保护 Workbench URL，以便本地能力不暴露给任意网页。
53. 作为实现者，我想让 MCP tools 和 Workbench HTTP API 共享同一个 project/session 与 command kernel，以便 Agent 和设计师操作同一组记录，且 MCP 不 loopback HTTP。
54. 作为实现者，我想让 Runtime 为所有 canvas record 分配 ID，以便 tldraw shape 只是投影而不是事实源。
55. 作为实现者，我想让 tldraw geometry 不进入研究事实源，以便布局丢失或重排不会破坏语义记录。
56. 作为实现者，我想让 Agent 只调用语义 MCP tools，以便 Runtime 可以在接受前校验 intent。
57. 作为实现者，我想禁止 raw exec 和单独几何工具，以便 Agent 不能绕过 Runtime 事实源。
58. 作为实现者，我想让 Agent 通过宿主原生文件编辑写 source artifact，以便复用 Agent host 的文件能力。
59. 作为实现者，我想要求 Agent 对每个 source artifact 写入调用 `record_artifact_written`，以便 Runtime 能记录事件、校验并生成派生 artifact。
60. 作为实现者，我想让 Runtime 只承认已声明且校验通过的 source artifact，以便研究记录保持诚实。
61. 作为实现者，我想让 Runtime 区分 semantic record schema、design-system artifact 和 prototype/code artifact 校验，以便不同失败模式有清楚处理。
62. 作为实现者，我想让 Runtime 最多请求一次修复，以便提高数据质量而不掩盖 Agent 错误。
63. 作为实现者，我想让 Runtime 不发明语义内容，以便研究数据不会被系统补造。
64. 作为实现者，我想用 Vitest unit + Playwright MCP/HTTP/Workbench 边界测试，以及仅测试内的 deterministic MCP client / test doubles，以便没有真实 Figma MCP 或真实 Agent host 时也能验证边界；真实 smoke 与 mock 明确区分。
65. 作为实现者，我想优先在 Cursor 做真实 Agent host smoke，并观察 Codex Desktop MCP tool 暴露问题，以便产品路径有务实 fallback。
66. 作为产品负责人，我想保持单项目单流程，以便一个月 MVP 受控。
67. 作为产品负责人，我想避免 MCP Apps inline UI 依赖，以便不被宿主渲染能力卡住。
68. 作为产品负责人，我想保留未来桌面打包可能性，以便不重写 Runtime 和 Workbench 核心。
69. 作为设计师，我想让 Agent 创建 Region Annotation，以便 Agent 暴露自己在哪里不确定或正在做假设。
70. 作为设计师，我想自己也能创建 Region Annotation，以便补充 Agent 没覆盖到的局部区域。
71. 作为设计师，我想让每个 Region Annotation 锚定到明确的 Evidence Surface，以便研究记录不会出现无上下文的“这里”。
72. 作为设计师，我想让 Runtime 根据标注区域提供排序后的 Figma node candidates，以便 Agent 更快定位需要深入读取的 source context。
73. 作为设计师，我想让 Agent 通过宿主 Figma MCP 核验 candidates 后确认 primary node，以便几何相交不会被误当成语义理解。
74. 作为设计师，我想让标注类型在视觉上区分 question、assumption、observed fact 和 generalization risk，以便快速扫描对齐状态。
75. 作为设计师，我不希望标注类型改变完成规则，以便卡片状态保持简单。
76. 作为研究者，我想区分 designer-initiated 与 agent-initiated Seed Reference，以便研究数据如实表达谁把证据带进对齐过程。
77. 作为实现者，我想让失败的 Figma capture 不提交 Seed Reference、Surface 或成功事件，以便项目中没有半写入的研究事实。
78. 作为实现者，我想让 PAT 只存在于 macOS Keychain，以便凭证不会进入项目数据库、artifact、日志或 export。
79. 作为产品负责人，我想把 OAuth 和多 Figma account 支持留作 Future Work，以便 MVP 先验证顺滑摄取的核心价值。
80. 作为设计师，我想在 Figma screenshot 上 hover 和选择语义节点并看到对应区域高亮，以便确认 Annotation 将锚定到正确结构。
81. 作为设计师，我想让 Annotation 可针对整个 Surface、明确 Figma node 或自由 Region，以便根据反馈粒度选择准确 target。
82. 作为设计师，我想默认只选择 Frame、Section、Component、Instance、Text、Image 和有意义的 Group，并按需深入 Vector/Path，以便结构选择不会被底层图层噪声淹没。
83. 作为设计师，我想在 Refresh 后知道历史 Node Annotation 是否仍能对应 current Figma node，以便不会误把过时反馈当成当前事实。

## Implementation Decisions

- 产品正式名称是 Ikran。
- MVP 必须在一个月内成为完整闭环研究原型，而不是只覆盖 seed extraction 的局部工具。
- MVP 是单项目、单流程。不支持多项目、多用户协作或分支。
- Ikran 采用传统 MCP + HTTP Workbench + tldraw，退役独立本地 app + headless CLI 产品路径。
- Ikran Runtime 是一个本地 daemon，**一进程两 surface**：stdio MCP server 与 custom Next HTTP/SSE Workbench，共享 command kernel；MCP 不经 HTTP loopback。
- Agent host 是 Cursor 或 Codex Desktop 等桌面 coding-Agent 应用。它拥有模型、Figma MCP、工具审批和文件编辑能力。
- Workbench URL 由 `open_workbench` 返回，包含 localhost 自动端口和启动级 session token。
- Workbench URL 可在任意浏览器打开；理想环境是 Agent host 的嵌入式浏览器。
- Runtime 只绑定 `127.0.0.1`，不开放宽泛 CORS。
- session token 随 Runtime 启动生成，关闭 Runtime 后失效。
- MCP tools 与 Workbench HTTP API 共享同一个 project/session 上下文与 command kernel。
- Figma Connection 是安装级、只读、单 active account 的 Workbench 前置门槛；MVP 使用 PAT + macOS Keychain，OAuth 与多账户为 Future Work。
- Seed Reference 支持 Workbench paste 与 Agent tool 双 initiator，共享同一 Runtime command、canonical identity 和原子提交边界。
- 不保留 AgentAdapter、`/api/tasks`、fake Agent connection、mock product families 作为产品路径。

### 最小 MCP 工具面

当前与近期工具：

- `open_workbench`：启动或复用 Runtime HTTP surface，返回 Workbench URL。
- `create_or_open_project`：绑定单项目工作区和 `.ikran` 状态。
- `get_figma_connection_status`：返回安装级 Figma Connection 的连接/验证状态，不暴露 PAT。
- `add_seed_reference`：Agent 添加 Figma selection link；与 Workbench paste 共享 Runtime command。Runtime 以 canonical `file_key` / normalized `node_id` 去重，成功 capture 后原子创建 Seed Reference、Figma Evidence Surface 与事件。
- `refresh_seed_reference`：显式重新捕获 positional evidence，在同一 evidence lineage 中追加并切换 current version。
- `get_seed_reference_context`：返回 Seed Reference、current positional evidence 与 source identity，供 Agent 决定是否继续调用宿主 Figma MCP。
- `get_annotation_node_candidates`：根据 Figma annotation 的 raw semantic rect 返回确定性排序的 node candidates；不自动确认 `primaryNodeId`。
- `create_annotation`：创建锚定到 captured Evidence Surface/version 的 Annotation；target union 支持 whole Surface、明确 Figma node 与 free Region，Region 持久化 raw semantic rect。
- `create_question_card`：创建带观察、问题、可选 `proposed_answer`、anchor 和阶段信息的 Question card。
- `record_designer_answer`：记录卡片上的 final answer 与 answer source。
- `record_artifact_written`：Agent 写 source artifact 后声明路径、类型、语义目的和关联记录。
- `record_preview`：声明或更新 prototype preview/run，并创建 **Prototype** Evidence Surface。
- `propose_rule_update`：记录 rule update proposal，等待设计师确认。
- `export_research_package`：对达标项目生成研究导出（整条成功语义链路，含闭环前阶段）。

不提供冗余 `create_evidence_surface`：Figma surface 由 Runtime 的 Seed Reference capture 创建；Prototype surface 由未来/后续 `record_preview` 创建。`list_pending_seed_evidence` 与 Agent-supplied `record_evidence_package` 不再属于 Active 工具面。

### Workbench 与画布模型

- 使用 Next.js 构建 Ikran workbench（custom server 与 MCP 同进程）。
- 使用 tldraw 作为空间画布底座。
- tldraw shape 是 canvas record 的投影，不是研究事实源。
- Geometry 包括位置、尺寸、viewport 和布局；它由 tldraw 管理，不作为研究数据持久化。
- Canvas record 是 Runtime-owned source of truth，包括 Evidence Surface、Region Annotation、Question card 和 designer answer。
- 每个 tldraw shape 必须携带对应 canvas record id。
- Agent 和设计师都提交 intent；Runtime 校验、分配 ID、持久化并广播。
- Agent 不直接操作画布，不调用 raw exec，不使用单独几何工具。
- 几何只能作为可选 display hint 或由 Workbench 本地管理。
- UI chrome 包括画布、stage tabs、左 question 面板和 Question card。
- Workbench 不提供右侧通用 chat；Agent host chat 承担开放澄清。
- Figma Connection Gate 关闭时显示设计师提供的连接面板并锁定画布；粘贴 Figma link 直接报错且不产生记录。
- Gate 打开后，Workbench canvas 接受 Figma selection link paste；具体连接、导入、错误与 refresh UI 必须遵循设计师提供的 Figma reference，不由实现自主设计。
- Figma screenshot 上可投影 structural overlay；hover 默认命中当前位置最深的 selectable node，`Tab` 逐级切到 selectable parent、到顶后保持，鼠标移动到新位置时重置为该处最深节点；stale warning 的具体视觉遵循设计师 Figma reference。
- 默认 selectable nodes 为 Frame、Section、Component、Instance、Text、Image 和有意义命名的 Group；Vector/Path 等底层节点不进入默认 hit-test。
- 画布不额外显示 node name/type/breadcrumb；Agent 通过 Runtime positional evidence 与宿主 Figma MCP 读取节点身份和父级信息。structural overlay 的 hover 与 Tab 临时选择属于 ephemeral UI state，不进入 Runtime semantic records 或 research export。
- 项目保存一个 Design Language Description；Seed Reference 保存可选 Reference Note。Description 可晚于 capture 填写，但为空时阻止正式 Design Intent Alignment。

### Evidence Surface 与 Region Annotation

- Evidence Surface 是设计师和 Agent 共同推理的画布对象。
- Figma Evidence Surface 用于 Seed Reference positional evidence 可视化；由 Runtime 成功 capture 时创建。
- Prototype Evidence Surface 用于 live iframe preview；由 `record_preview` 创建。
- Evidence 为 append-only：新 package 可 supersede 旧 surface；查询当前证据使用 `current_surface_id` / lineage（`superseded_by`）。
- Seed Reference 同时保留两层表达：verbatim submitted URL 用于审计与显示；canonical `file_key` / normalized `node_id` 用于关系关联与幂等判断。
- Region Annotation 是一等持久记录，必须锚定到明确 Evidence Surface。
- Annotation target 支持 whole Surface、明确 Figma node 和自由 Region；只有提交 Annotation 后 target 才成为 Runtime-owned semantic record。
- Figma Node Annotation 必须同时保存 `surface_id`、captured `evidence_version_id` 与明确 `node_id`；不能只指向 current node 而丢失历史版本。
- 没有 `surfaceArtifactId` 或 `surfaceNodeId` 的 Region Annotation 无效。
- Figma 阶段使用 `figma-region` anchor。
- Prototype 阶段使用 `prototype-region` anchor。
- Runtime 可按 annotation rect 与 positional node bounds 的空间关系返回排序 candidates，但不推断语义 primary node；Agent 经宿主 Figma MCP 核验后才可确认 `primaryNodeId`。
- Workbench 使用 positional node hierarchy/bounds 在 screenshot 上进行 hit-test 与高亮，不物理切割并持久化每个 node screenshot；只有选中/提交时才可按需生成 crop。
- Refresh 后 Node Annotation 仍锚定原 evidence version。若 current positional index 存在可信 correspondence，可显示对应 current node；若不存在，必须标记 Stale Annotation 并提示设计师，不得静默迁移或删除。
- Prototype region 必须包含 bounding box 和 normalized rect。
- **Annotation 持久化 raw semantic rect**；Agent display padding 在 Workbench projection 层重算，不回写为语义事实。成功语义记录与 Agent annotation 原始区域可回放。
- DOM selector、component id 和 element candidates 是 prototype region 的可选增强。
- 标注类型是视觉辅助，不影响 Question card 完成规则。
- Annotation 类型/权限的新语义（相对当前 AC）明确留给后续 Issue，不在本 PRD 冻结为已实现。

### Figma 接触面

- Ikran Runtime 不嵌入、不实现、不代理 Figma MCP。
- Runtime 通过安装级、只读 Figma Connection 直接调用 Figma REST API；MVP 使用用户提供的 PAT，安全存储于 macOS Keychain并跨本地项目复用。
- PAT 不进入项目 SQLite、`.ikran/`、artifact、日志、事件 payload 或 research export；API/MCP 不得回传凭证。
- 未连接或连接验证失败时 Figma Connection Gate 保持关闭，画布锁定，paste/add 请求 fail closed 且不创建 Seed Reference。
- Runtime 仅摄取 Figma positional evidence：截图、canonical source identity 与区域定位所需的最低 node identity/name/type/bounds 数据。
- positional node index 可包含 parent identity、depth、visibility/selectability 与 clip/render bounds，以支持 structural overlay、hit-testing、`Tab` parent drill-up 和 refresh correspondence；不得借此扩大为完整 implementation context。
- Runtime 不预取 implementation context。布局、样式、组件、变量及其他实现级细节由 Agent 根据 source identity/candidates 按需通过宿主 Figma MCP 获取。
- Runtime capture 是 positional evidence 的唯一 Active 产品来源；Agent 不上传或声明 Figma screenshot/evidence package。
- 新 Seed Reference、初始 positional evidence、Figma Evidence Surface 与成功事件原子提交；无效 link、403/404、限流或 capture 失败不留下半成品记录或成功研究事实。
- 重复提交同一 canonical source 只复用并聚焦已有 Frame；不自动 refresh。显式 Refresh 才追加新的 append-only evidence version。
- Figma visual surface、截图和 crop 用于人类可视化、定位和研究回放；实现 prototype 时 Agent 应按需读取 source details，不把截图当成唯一结构输入。

### 项目文件夹与 artifact

- 设计师提供一个本地项目文件夹。
- 项目文件夹成为完整研究案例：`.ikran/`、workflow 文件、source artifact、derived artifact、prototype code 和 export 共存。
- `.ikran/` 存放 Runtime 元数据、SQLite、derived event export、config、artifact index 和 research export。
- Source artifact 是 Agent 通过 Agent host 原生文件编辑写入的事实源项目文件，例如 design-system markdown、`token.json`、component specs 和 prototype code。
- Derived artifact 是 Runtime 从 source artifact 生成的文件，例如 `design-system-view.json` 和 research export。
- Runtime 不代理 source artifact 写入。
- Agent 写 source artifact 后必须调用 `record_artifact_written`。
- 已声明且校验通过的 source artifact 进入事件日志、artifact index、derived artifact 生成和研究导出。
- 已写入但未声明的文件变化最多作为 warning/open gap，不自动进入事实源，也不进入研究导出。
- 声明后校验失败时，Runtime 可记录 invalid-output/invalid-artifact 供运维调试，可请求一次修复；修复仍失败时不补造语义，且不把失败当作成功研究事实导出。

### Question card 与阶段接受

- Agent 可在 Question card 上提供 `proposed_answer`。
- 设计师可编辑答案，或在阶段级「接受并继续」时接受未修改的预填答案。
- Answer source：
  - 未修改预填答案被阶段接受 → Agent 提议 / 设计师接受。
  - 设计师编辑后的答案 → designer edited。
- 仍为空则阻止继续。
- 禁止空问题与空 final answer；允许填「同意/对」等非空短答。
- 卡片状态仍以 unanswered / answered 为主；开放澄清留在 Agent host chat。

### 原型技术栈与 Preview

- 默认 prototype stack 是 Next.js、TypeScript、Tailwind CSS 和 npm。
- Tailwind 是实现语法，不是设计源。
- `workflow/design-system/token.json` 是 design token source of truth。
- Tailwind config 是由 Agent 维护或生成的派生实现映射。
- MVP 不要求确定性 token-to-Tailwind 生成脚本。
- Runtime 启动或检测本地 dev server，并暴露稳定 preview URL。
- Prototype Evidence Surface 使用 live iframe preview，不使用截图历史替代交互审查。
- Workbench 提供 focus mode 打开 preview URL。
- Runtime 通过 preview 代理注入脚本和 postMessage 做 DOM inspection 可用版。
- DOM inspection 失败时，prototype Region Annotation 仍有效。
- Runtime 可以生成 viewport screenshot 和 selected crop 作为上下文 artifact，但截图不替代 live iframe。

### Seed Extraction 与 Design System

- 一个项目可添加任意数量、共同表达同一种设计语言的 Seed References；不同 Seed References 以 canonical `file_key/node_id` 区分。
- 项目级 Design Language Description 只填写一次；每条 Seed Reference 可追加可选 Reference Note。
- Seed Reference capture 与可视化不等待 Design Language Description；Description 为空时不得进入正式 Design Intent Alignment。
- Seed extraction / Design Intent Alignment 对当前 Seed Reference collection 执行一次；MVP 不在完成后重新开启一套不同设计语言的 seed extraction。
- 种子对齐使用六部分 Design Intent Alignment：Design principle、Visual language、Token、Layout、Component、Interaction。
- Content style observations 不作为 MVP 必答阶段，也不能阻塞 seed extraction。
- Agent 在第一次 pass 中生成所有阶段的问题。
- 每个阶段二到五张 Question card。
- 所有 Question card 都必须有非空 final answer 后才能继续。
- 卡片状态只需要 unanswered 和 answered。
- 初始 design-system source artifact 包括 design-system candidate/source、`token.json`、component list/specs、layout/interaction rules 和 evidence registry。
- `design-system-view.json` 是 Runtime 或 Agent 声明后生成的 derived artifact，用于 Workbench 稳定渲染。
- 设计系统浏览器以阅读为先，不提供复杂手动编辑器。

### New Prototype 与 Rule Recursion

- 种子提取和初始设计系统完成后，主循环是创建新原型、审查它、更新规则、创建下一个原型。
- 人类意图优先创建是主要路径。
- Visual reference 是可选输入。
- Agent 创建真实 prototype code，并通过 `record_artifact_written` 声明。
- 每个 prototype run 应产生 Prototype Evidence Surface。
- Prototype feedback 可锚定到 whole surface 或 prototype region。
- Rule recursion 发生在 prototype feedback、设计系统页面反馈或审查发现之后。
- Agent 将反馈分类为局部例外、可复用候选、规则冲突、开放缺口、拟议更新或未发现。
- 所有设计系统变更必须先形成 proposal，再由设计师 Confirm 或 Cancel。
- Confirm 后 Agent 写 source artifact 并声明；Cancel 不修改 source artifact，且 Cancel 不进入成功研究导出门槛。

### Data 与 Research Export

- Runtime 使用 SQLite 进行状态与 **canonical** 事件存储；record 与 event 在同一 SQLite 事务中提交。
- JSONL event log 是可从 SQLite 重建的 **derived export**，不是第二事实源。
- 事件粒度是语义动作，不记录低层 UI 噪声。
- 成功研究 canonical events 必须覆盖 project creation、folder selection、Figma connection gate outcome（不含凭证）、Seed Reference initiator、successful positional-evidence capture、Evidence Surface、Region Annotation、Question card、designer answer、design-system artifact、preview、prototype run、feedback、rule proposal、confirmed rule update 和 export。
- Prototype run 和 rule update 必须尽量链接回相关 question、answer、design-system version、Evidence Surface 和 Region Annotation。
- **成功研究案例入选门槛：** Design System v1 → 新原型 → 反馈 / 确认规则更新 → Design System v2 → 第二次新设计。仅完整走完该成功递归的项目**有资格**生成研究导出。
- **导出内容：** 达标后的 research export 必须包含该项目整条成功语义链路（含闭环完成前的 seed、evidence、annotation、alignment、DS v1、第一次原型等），不是只导出终点。Runtime 在闭环完成前就持续记录成功语义事实；门槛只约束导出资格，不表示闭环前没有研究痕迹。
- **不进入研究导出：** 失败请求、失败标注、草稿、取消、Open Gap、canvas layout。取消可以作为产品状态或独立运维/调试记录存在，但不是成功研究 canonical event / export 的要求。运维调试仍可保留失败日志；它们不是研究事实。
- 成功语义记录与 Agent annotation 的 raw semantic region 可回放。
- Research export 对 Figma Node Annotation 保留 captured evidence version、node id 与 current correspondence/stale 状态；hover、highlight、临时 selection 和 breadcrumb 不进入事件或 export。
- Research export 输出到 `.ikran/export/`。
- 最小导出包括 `events.jsonl`、`project-summary.json`、`alignment-questions.json`、`designer-answers.json`、`prototype-runs.json`、`rule-update-proposals.json` 和 `artifacts-index.json`。

## Testing Decisions

最高价值测试边界：

```text
Workbench paste + MCP client
        -> shared Runtime command kernel
        -> deterministic Figma API / credential-store test doubles
        -> SQLite records + Workbench projection + export
```

测试应验证外部行为、持久记录和导出结果，而不是实现细节。MVP 风险在于跨 surface 工作流协调、事实源边界和 artifact 声明。

- Playwright + MCP 的 one-process 纵切是主要产品验收 seam，覆盖 Connection Gate、双 initiator、capture、projection、dedupe、annotation candidates 与 refresh lineage。
- Vitest 只补充 URL canonicalization、candidate ranking、原子事务与安全架构守卫等难以从 UI 精确诊断的纯逻辑。
- 使用 deterministic MCP client / test doubles（仅测试），直接打 MCP tool handlers 或 HTTP 边界。
- Figma API 与 credential store 必须可注入 deterministic test doubles；测试凭证不得接触真实 Keychain 或网络。
- 使用临时项目文件夹验证 `.ikran/`、source artifact declaration、derived artifact 和 export。
- **禁止**全局 `pkill` 作为测试清理手段。
- **明确区分** automated / mock 与真实 Agent host / 真实 Figma smoke；不把 mock success 伪装成真实 success。
- 不保留产品路径上的 mock AgentAdapter / fake Agent connection。

### 必测行为

- `open_workbench` 返回 localhost Workbench URL，URL 包含 session token。
- Workbench URL 可在浏览器打开。
- 缺失或错误 session token 被拒绝。
- MCP tools 和 Workbench HTTP API 操作同一个 project/session（一进程、shared command kernel）。
- Runtime 能创建并恢复 `.ikran/` project state。
- 未连接/无效 Figma Connection 时显示连接面板并锁定画布；Workbench paste 与 Agent add 均 fail closed 且不创建记录。
- PAT 只写入 macOS Keychain adapter；API、SQLite、日志、artifact 与 export 不出现凭证。
- Workbench paste 与 Agent `add_seed_reference` 共享同一 command kernel；成功结果除 initiator 外一致。
- canonical `file_key` + normalized `node_id` 幂等；忽略 share-time 等非身份参数；重复提交只复用并聚焦一个 Frame。
- 成功 capture 原子创建 Seed Reference、positional evidence、Figma Evidence Surface 与事件；无效/无权限/限流/截图失败不留下半成品或成功研究事实。
- Runtime 只保存 screenshot 与最低 positional node index，不把实现级 Figma context 预摄取进项目。
- 显式 Refresh 在同一 lineage 中追加新 evidence version；重复 paste 不 refresh，历史 Surface/annotation 可回放。
- Design Language Description 为空不阻塞 capture，但阻塞正式 Design Intent Alignment；Reference Note 可选。
- annotation rect 可得到确定性排序 node candidates；Runtime 不自动确认 primary node。
- screenshot structural overlay 默认只命中语义节点；hover 高亮与 `Tab` parent drill-up 不写研究事实，node name/type/parent 只供 Runtime/Agent 读取，不增加画布 chrome。
- Annotation 可分别锚定 whole Surface、明确 Figma node 或自由 Region；node target 必须包含 captured evidence version。
- Refresh 有 correspondence 时可提示 current node；无 correspondence 时历史 Node Annotation 标记 stale 并向设计师提示，不自动迁移。
- tldraw shape 能投影 canvas record，shape id 不成为语义事实源。
- Region Annotation 必须包含 surface anchor；raw semantic rect 持久化，display padding 在投影层重算。
- Question card 必须包含 anchor、Agent observation、Agent question；允许 `proposed_answer`；final answer 非空；answer source 可区分。
- 所有 Question card answered 后才允许 seed extraction 继续；阶段「接受并继续」遵守 answer source 规则。
- `record_artifact_written` 后 Runtime 记录事件、校验 source artifact，并生成 derived artifact。
- 未声明 source artifact、失败/草稿/取消/Open Gap/canvas layout 不进入 research export。
- Preview readiness 能反映到 Workbench。
- Prototype Evidence Surface 能嵌入 live iframe。
- Prototype region selection 能产出 bounding box、normalized rect、selected crop 和可用 DOM candidates。
- Rule update proposal 支持 Confirm 和 Cancel；Cancel 不修改 source artifact。
- Research export 仅对完整成功递归项目生成；内容包含该项目整条成功语义链路（事件、问题、回答、prototype run、rule proposal、artifact index 等，含闭环前成功阶段），不是只导出终点。
- one-process / direct MCP（无 HTTP loopback）边界有自动化覆盖。

### 手动真实 smoke

- 使用真实 PAT 完成安装级 Figma Connection，并验证凭证只进入 macOS Keychain。
- Connection Gate 解锁后，粘贴真实 Figma selection link 能在没有 Agent 参与的情况下生成可视 Figma Evidence Surface。
- 重复粘贴同一真实 node 只复用一个 Frame；显式 Refresh 创建同 lineage 新版本。
- Cursor 能发现 Ikran MCP tools，并通过 `open_workbench` 返回 Workbench URL。
- Workbench URL 能在 Cursor 嵌入式浏览器打开；复制到系统浏览器也能打开。
- Codex Desktop MCP tool 暴露需要 smoke 验证；若受 `openai/codex#26659` / `#26072` 影响，记录 fallback。
- Agent 能根据 Runtime 提供的真实 node candidates，使用宿主 Figma MCP 获取实现级 context 并确认 primary node。
- Agent 能写 source artifact，并通过 `record_artifact_written` 声明。
- 真实空项目文件夹能初始化 Next.js/TypeScript/Tailwind/npm prototype。
- Live iframe preview 和 focus mode 能手动使用。
- tldraw Evidence Surface、Region Annotation 和 semantic record id 能回连；raw annotation region 可回放。
- 真实 smoke 与 automated mock 结果分开记录，不互相冒充。

## Out of Scope

- 独立 `npx ikran` 打开自己浏览器并 spawn headless CLI Agent 的产品路径。
- Hardened headless CLI AgentAdapter 作为 MVP 产品路径。
- AgentAdapter、`/api/tasks`、fake Agent connection、mock product families 作为产品路径。
- 冗余 `create_evidence_surface` MCP tool。
- MCP Apps inline UI。
- Ikran Runtime 实现或代理 Figma MCP；Runtime 只调用 Figma REST API 捕获 positional evidence。
- Runtime 预取完整 Figma implementation context 或实现 Figma-to-code converter。
- 把 Figma screenshot 物理切割并持久化为每个 node 的独立图片；MVP 使用一张 capture + structural overlay + 按需 crop。
- OAuth、Figma OAuth app review/token broker 与多 Figma account 切换（Future Work）。
- Runtime 代理 source artifact 写入。
- raw exec MCP tool。
- 单独 geometry MCP tool。
- tldraw/Miro 式通用自由白板。
- 多项目工作空间。
- 多用户协作。
- 远程 Workbench URL、跨设备访问或云协作。
- 云托管 runner。
- 完整浏览器 IDE 或代码编辑器。
- Workbench 直接访问本地文件系统。
- App 内模型 runtime。
- 完整 ACP 实现。
- WebContainers runtime。
- Sandpack 组件库预览。
- 复杂设计系统手动编辑器。
- 独立 Rules 页面。
- 完成 Design Intent Alignment 后以另一种设计语言重跑 seed extraction。
- 在同一项目中混合不同设计语言的 Seed References。
- 基于截图生成 seed prototype。
- 截图历史替代 live iframe preview。
- 完整可视化分析 dashboard。
- 生产级 packaging、installer、团队 auth 或 billing。
- 把失败请求、草稿、取消、Open Gap 或 canvas layout 当作成功研究事实导出。

## Further Notes

Ikran 的战略方向是成为递归式 designer-Agent alignment workbench；MVP 的战术边界是一个月内完成本地、单项目、可研究闭环。所有实现都应优先保护三件事：

1. Runtime-owned semantic records 是事实源。
2. Runtime 负责 Figma positional evidence；Agent host 负责实现级 Figma context、模型和文件编辑；Ikran 继续负责记录、校验、preview 和导出。
3. Workbench 是空间化结构表面，不是另一个 chat，也不是通用白板。

`Issues 02/` 是按本文重排的 issue 组。旧 `issues/` 中的 Issue 14 headless CLI 产品路径废弃，Issue 16 改为 Agent host MCP smoke，Issue 04/07 的画布基础从 React Flow 改为 tldraw，并新增 Workbench URL 启动协议的竖切。

架构收口细节见 `docs/adr/0002-consolidate-runtime-and-research-records.md` 与 `docs/adr/0003-runtime-owned-figma-positional-evidence.md`。Issue 05 之后需要新增 Runtime-owned Figma ingestion 转型 issues，并同步 Issue 06–16 的目标、依赖与验收；本文不声称这些 issue 已实现完成。
