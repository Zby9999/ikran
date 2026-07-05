# Ikran MVP PRD（中文）

状态：ready-for-agent
目标：一个月内可用的研究原型
日期：2026-07-04

## 问题陈述

使用 agentic 设计工作流的设计师已经可以让编码 Agent 产出原型，但交互仍然过于依赖语言，也过于脱离设计画布。当 Agent 不理解一个 Figma 种子页面时，设计师必须从聊天线程中推断 Agent 到底困惑在哪里。这会让设计意图对齐变慢、难以审计，也难以沉淀成持久的设计系统。

现有的 Recursive Design Method 已经定义了正确的工作流：从 Figma 种子页面开始，对齐意图，提取一个设计师和 Agent 都能双向阅读的设计系统，将种子重建为交互式原型以验证代码、视觉和语义的一致性，然后使用生成的设计系统创建新原型，并递归更新规则。现在缺少的是一个本地优先的可用工作台，让这套工作流变得可见、空间化，并适合收集研究数据。

MVP 必须在一个月内成为完整闭环的研究原型。它必须支持：

- 种子页面提取，
- 新设计创建，
- 规则递归，
- 基于事件日志的研究数据收集，
- 本地原型预览，
- 以及一个项目本地的设计系统，且设计师和 Agent 都能阅读。

产品在第一个月不能变成完整的在线 IDE、Figma 替代品，或通用 AI App 生成器。它应该是一个单项目、单流程的工作台，用于研究递归式设计师-Agent 对齐。

## 解决方案

将 Ikran 构建为一个本地优先的工作台，通过 npm/npx 启动，并在用户自己的浏览器中交互。Ikran Runtime 是本地应用进程：它负责托管浏览器 UI、暴露同源 Runtime API、拥有本地文件系统访问能力、通过 headless CLI 适配器运行 Codex、Claude Code 或 Cursor 等外部编码 Agent，并管理实时原型预览。

产品形态应接近 Storybook、Vite 或 JupyterLab：用户启动一个本地工具，工具打开浏览器标签页，浏览器成为本地工作空间的交互界面。MVP 中，Ikran 不应是一个云端 Web App 再连接独立的本地 companion daemon。

浏览器 UI 提供：

- 由 React Flow 驱动的研究工作流画布，
- 作为 Evidence Surface 的 Figma 种子证据表面或实时 prototype iframe surface，
- Evidence Surface 内部的区域标注 overlay，
- 顶部阶段标签页用于对齐，
- 左侧项目流程和问题列表，
- 右侧 Agent 侧栏用于回答和细化当前问题，
- 种子提取完成后的设计系统浏览器，
- 原型的实时 iframe 预览，
- 以及最小化的研究导出。

Ikran Runtime 负责：

- 用户选择的本地项目文件夹，
- 项目本地 `.ikran/` 元数据，
- 系统原生文件夹选择器，
- SQLite 状态，
- JSONL 事件日志，
- Agent 进程执行，
- schema 校验，
- 本地开发服务器生命周期，
- 预览 URL/代理，
- 以及研究导出。

外部 Agent 负责：

- 使用用户已配置的 Figma MCP 摄取 Figma 数据，
- 创建证据包，
- 生成种子对齐问题，
- 提取设计系统草稿，
- 重建种子原型，
- 设计并创建新原型，
- 生成规则更新提案，
- 以及生成设计系统视图 JSON。

Figma MCP 有意不嵌入 Ikran Runtime。Runtime 应要求被选中的外部 Agent 环境已经具备可用的 Figma MCP 访问能力。这样可以保持性能，并避免在没有 Figma 远程 MCP 优势的情况下构建一个较弱的本地 Figma 集成。

## 用户故事

1. 作为设计师，我想从一个 Figma 种子页面开始 Ikran 项目，以便从我已经使用的源文件中提取设计语言。
2. 作为设计师，我想选择一个空的本地项目文件夹，以便 Agent 可以从种子页面创建设计系统文件和原型代码。
3. 作为设计师，我想让 App 引导我完成种子提取，以便我不需要理解底层 Recursive Design Method 文件结构。
4. 作为设计师，我想让 Agent 读取 Figma 的视觉证据和结构化证据，以便问题建立在真实的布局、组件、排版和样式数据之上。
5. 作为设计师，我想让 Agent 在设计画布上创建标注，以便我能准确看到 Agent 哪里不确定或正在做假设。
6. 作为设计师，我想让 Agent 而不是我成为主要的标注发起者，以便 Agent 暴露自己的理解状态，而不是让我手动标注所有内容。
7. 作为设计师，我想在浏览器 UI 内回答 Agent 的问题，以便我不需要离开视觉工作空间去另一个窗口和编码 Agent 对话。
8. 作为设计师，我想让当前问题将画布平移或缩放到相关证据锚点，以便我可以在视觉上下文中回答。
9. 作为设计师，我想让每张问题卡都包含 Agent 观察、Agent 问题和我的回答，以便后续容易理解对齐记录。
10. 作为设计师，我想让问题卡支持多轮澄清，以便不清晰的回答可以变成最终设计师回答。
11. 作为设计师，我想让卡片的最终状态保持简单，以便我只需要回答问题，而不是把它们分类到很多状态中。
12. 作为设计师，我想让问题卡按设计主题分组，以便我可以结构化地完成对齐。
13. 作为设计师，我想让种子对齐阶段包含布局、组件提取、交互风格、视觉风格和泛化能力，以便首次设计系统提取覆盖重要维度。
14. 作为设计师，我想让每个阶段包含二到五个问题，以便流程既不会太浅，也不会让人不堪重负。
15. 作为设计师，我想让所有生成的问题都成为种子提取门禁的必答项，以便研究工作流中没有设计维度被跳过。
16. 作为设计师，当 Agent 的假设已经正确时，我想简短作答，以便必答覆盖不总是意味着大量写作。
17. 作为设计师，我想让每个问题都锚定到局部区域、Figma 节点或整个 frame，以便即使是全局问题也仍然绑定到证据。
18. 作为设计师，我想让标注类型在视觉上可区分，以便问题、假设、观察事实和泛化风险容易浏览。
19. 作为设计师，我不希望标注类型改变完成规则，以便所有卡片行为保持一致。
20. 作为设计师，我想让种子提取只在项目启动时执行一次，以便后续设计工作可以通过更轻量的规则更新和原型反馈进行。
21. 作为设计师，我想让 App 在启动完成后停止显示种子提取控制，以便项目转入设计系统浏览和原型创建。
22. 作为设计师，我想在种子提取后查看当前设计系统，以便了解 Agent 提取了什么。
23. 作为设计师，我想让设计系统浏览器展示重要摘要和视觉样例，以便我不必为了每次检查都阅读原始文件。
24. 作为设计师，我想让设计系统浏览器遵循 Foundations 和 Components 结构，以便它感觉像一个设计系统，而不是文件查看器。
25. 作为设计师，我想要 Color、Typography、Materials、Layout 和 Interaction 页面，以便规则在其所属位置被解释。
26. 作为设计师，我不想要单独的 Rules 页面，以便用法规则不会脱离 foundations。
27. 作为设计师，我想要 Component inventory 和 Component detail 页面，以便提取出的组件可见且可审查。
28. 作为设计师，我想让每个 foundation 页面包含语义角色、视觉样例和简短用法说明，以便系统易于理解，但不会变成复杂编辑器。
29. 作为设计师，我想让每个设计系统页面包含一个小型 Agent 侧栏，以便我可以在上下文中请求修改。
30. 作为设计师，我只想在 Agent 侧栏旁看到简单提示，以便内部工作流标签不会让页面杂乱。
31. 作为设计师，我想从当前正在查看的页面发起规则更新，以便我不需要导航到单独的规则更新界面。
32. 作为设计师，我想让系统仍然在底层运行规则更新工作流，以便变更保持受治理且可追踪。
33. 作为设计师，我想在设计系统文件变更之前看到更新提案，以便我可以批准或拒绝 Agent 的解释。
34. 作为设计师，我想让更新提案展示将改变什么、为什么改变以及受影响项，以便我可以快速决策。
35. 作为设计师，我想要规则更新的 Confirm 和 Cancel 操作，以便没有设计系统变更会被静默应用。
36. 作为设计师，我想让生成的设计系统保持为可阅读的 Markdown 和 JSON，以便人和 Agent 都能使用。
37. 作为设计师，我想让浏览器 UI 读取生成的 design-system-view JSON 文件，以便 UI 稳定，而不依赖解析 Markdown 表格。
38. 作为设计师，我想让作为事实源的设计系统文件保留在本地项目文件夹中，以便项目可移植且可审计。
39. 作为设计师，我想让 App 在我选择的本地项目文件夹中创建原型，以便原型是真实代码，而不是临时 UI artifact。
40. 作为设计师，我想让 Agent 在文件夹为空时初始化项目，以便我不需要先准备代码库。
41. 作为设计师，我想让默认原型技术栈为 Next.js、TypeScript、Tailwind CSS 和 npm，以便生成的项目使用熟悉的设计与原型约定。
42. 作为设计师，我想让 Tailwind 成为实现层，而不是设计源，以便设计语言仍由 token 和设计系统文件治理。
43. 作为设计师，我想让 token.json 驱动 Tailwind 配置生成，以便设计 token 和实现保持对齐。
44. 作为设计师，我想让 Agent 将原始种子页面重建为实时原型，以便代码、视觉输出和语义设计系统规则可以一起检查。
45. 作为设计师，我想让原型以实时 iframe 预览展示，以便我可以持续看到变化，而不是依赖截图。
46. 作为设计师，我想让 Agent 修改代码时预览保持同步，以便浏览器 UI 感觉像一个实时设计工作空间。
47. 作为设计师，我想要一种 focus mode 直接打开本地预览，以便我可以在真实原型中体验交互。
48. 作为设计师，我想让 App 在设计工作中使用实时预览，而不是截图历史，以便交互保持核心地位。
49. 作为设计师，我想在初始设计系统存在后，从人的意图创建新原型，以便系统可以测试提取出的设计语言是否可复用。
50. 作为设计师，我想为新原型创建提供可选视觉参考输入，以便当仅靠意图不足时，我可以提供布局参考。
51. 作为设计师，我想让人类意图优先的新设计创建成为默认方式，以便研究聚焦于从已对齐设计语言中生成设计。
52. 作为设计师，我想让新原型创建和规则递归在种子提取后成为主循环，以便设计系统通过真实工作成长。
53. 作为设计师，我想对生成的原型提供反馈，以便 Agent 可以识别当前设计系统哪里不足。
54. 作为设计师，我想让 Agent 将反馈分类为可复用候选、局部例外、冲突、开放缺口或拟议更新，以便设计系统在不被污染的情况下成长。
55. 作为设计师，我想让规则递归在应用变更前产出提案，以便我仍是最终决策者。
56. 作为研究者，我想让每个有意义的对齐动作都记录为事件，以便分析设计意图如何被协商。
57. 作为研究者，我想让事件日志记录 Agent 标注、问题、设计师回答、原型运行和规则更新提案，以便实验捕捉过程，而不只是结果。
58. 作为研究者，我想让事件日志避免记录每次平移和缩放等低层 UI 噪声，以便数据聚焦在语义对齐上。
59. 作为研究者，我想让原型运行和规则更新链接回影响它们的问题和答案，以便研究对齐如何影响输出。
60. 作为研究者，我想要 JSON/JSONL 导出包，以便实验数据可以在 App 外分析。
61. 作为研究者，我想让工作流文件、证据注册表、原型源代码和事件日志共同存在于项目文件夹中，以便研究案例可复现。
62. 作为研究者，我想让 App 在 MVP 中支持单项目、单流程，以便实验保持受控。
63. 作为实现者，我想让浏览器 UI 只与 Ikran Runtime 通信，以便浏览器代码永远不会直接读取或写入本地文件。
64. 作为实现者，我想让 Ikran Runtime 暴露 HTTP API 和 Server-Sent Events，以便可靠追踪浏览器 UI 交互和长时间运行的 Agent 任务。
65. 作为实现者，我想要统一的 AgentAdapter 接口，以便 Codex、Claude Code、Cursor、SDK adapter 或未来 ACP adapter 可以替换，而无需重写浏览器 UI。
66. 作为实现者，我想让第一个 adapter 使用 headless CLI 执行，以便 MVP 可以快速复用现有 Agent 工具。
67. 作为实现者，我想让 Runtime 校验所有 Agent JSON 输出，以便无效结构不会破坏 UI。
68. 作为实现者，我想让 Runtime 最多要求 Agent 修复一次无效输出，以便提高数据质量而不隐藏错误。
69. 作为实现者，我不想让 Runtime 在 Agent 输出无效时发明语义内容，以便研究数据保持诚实。
70. 作为实现者，我想要项目本地 `.ikran/` 元数据，以便 App 状态、事件和导出随研究项目一起移动。
71. 作为实现者，我想使用 SQLite 存储状态/索引，使用 JSONL 进行导出，以便 App 可靠，同时研究数据保持可移植。
72. 作为实现者，我想让 Runtime 管理开发服务器生命周期，以便 Agent 不会变成脆弱的进程监督器。
73. 作为实现者，我想让 Agent 负责设计推理和原型创建，以便 Runtime 保持确定性。
74. 作为实现者，我想让 Figma MCP 访问保留在外部 Agent 环境内，以便 MVP 可以依赖用户配置的 Figma Remote MCP 性能。
75. 作为实现者，我想通过 adapter 边界保留未来 ACP 兼容性，以便 Ikran Runtime 可以成熟演进而不需要重写。
76. 作为设计师，我想通过 npm/npx 启动 Ikran，以便无需先安装云端连接型桌面产品，也能把它作为本地工作台使用。
77. 作为设计师，我想让 Ikran 启动后自动打开浏览器，以便本地 Runtime 感觉像一个完整应用，而不是两个割裂的服务。
78. 作为设计师，我想通过操作系统原生文件夹选择器选择项目文件夹，以便文件夹选择可信且符合系统习惯。
79. 作为实现者，我想让浏览器 UI 通过同源 API 与 Runtime 通信，以便 Ikran 避免 CORS、companion daemon 发现和云到本地信任问题。
80. 作为实现者，我想让 Runtime 只绑定 localhost，并用启动时生成的 session token 保护会话，以便本地文件系统和命令执行能力不会暴露给任意网页。
81. 作为产品负责人，我想让同一套 Runtime 和浏览器 UI 未来可以被包装为桌面应用，以便 Ikran 后续能从 npm/npx 启动过渡到更完整的原生分发，而无需重写核心工作流。

## 实现决策

- 产品正式名称是 Ikran。
- MVP 必须在一个月内成为完整闭环的研究原型，而不是只覆盖种子提取的局部工具。
- MVP 是单项目、单流程。它不支持多项目、多人协作或分支。
- 工作流有两个生命周期阶段：
  - 通过种子提取完成一次性的设计系统启动，
  - 启动后重复执行新原型创建和规则递归循环。
- MVP 中不会重新运行种子提取。如果需要不同种子，用户创建新项目。未来从另一个种子/参考中混合设计语言的能力留待后续。
- App 应遵循 Recursive Design Method 的阶段顺序：
  - 对齐设计意图，
  - 提取种子设计，
  - 从设计系统或视觉参考创建新设计，
  - 更新规则。
- 第一个月必须包括：
  - 种子页面提取，
  - 新设计创建，
  - 规则递归。
- 新设计创建同时支持人类意图优先和视觉参考优先输入，但人类意图优先是主要路径。
- 核心用户是设计师；UI 不应暴露不必要的工程状态。

### 产品形态与启动方式

- Ikran 是本地优先工作台，不是云端 Web App 加本地 companion Runtime。
- MVP 应通过 npm/npx 启动，例如 `npx ikran`。
- 启动时运行一个本地 Ikran Runtime 进程，并打开浏览器标签页进入本地 UI。
- Ikran Runtime 从同一个本地 origin 托管浏览器 UI 和 Runtime API。
- 浏览器 UI 通过同源 `/api/*` endpoint 和 SSE 事件流与 Runtime 通信。
- Runtime 默认绑定 `127.0.0.1`。
- MVP 中 Runtime 不应开启宽泛 CORS。
- Runtime 应生成启动级本地 session token，避免任意网页调用有权限的本地 API。
- 同一套 Runtime 和浏览器 UI 应保持未来可包装为 Tauri 或 Electron 桌面应用。
- 桌面化是未来分发层，不应导致 MVP 核心工作流重写。

### 浏览器 UI

- 使用 Next.js 构建浏览器 UI。
- 使用 React Flow 作为研究工作流画布基础。
- React Flow 用于承载 Evidence Surface、prototype run、artifact 和 question 等高层工作流节点。
- React Flow 的 nodes/edges/viewport 是 UI layout state，不是研究数据的事实源。
- 区域标注不进入 React Flow nodes；它们作为独立 workflow records 存在，并由所属 Evidence Surface 的 overlay 实时渲染。
- UI 遵循用户的 Figma 交互草图：
  - 顶部区域用于阶段标签页，
  - 左侧区域用于项目流程和问题列表，
  - 中央区域用于设计/原型画布，
  - 右侧区域用于回答选中的问题或使用 Agent 侧栏。
- 浏览器 UI 永远不直接读取或写入本地项目文件。
- 浏览器 UI 通过同源 HTTP API 和 SSE 事件流与 Ikran Runtime 通信。
- 浏览器 UI 通过 iframe 实时预览嵌入原型。
- 浏览器 UI 不存储原型代码。
- 浏览器 UI 不运行内部模型，也不构建自己的 Agent runtime。

### Ikran Runtime

- 使用一个本地 Ikran Runtime 进程来托管浏览器 UI、暴露 Runtime API，并协调外部 Agent。
- Ikran Runtime 暴露同源 HTTP API 用于命令，暴露 SSE 用于任务进度。
- Ikran Runtime 负责：
  - 浏览器 UI 托管，
  - 项目文件夹选择和校验，
  - 项目本地 `.ikran/` 元数据，
  - 系统原生文件夹选择器，
  - SQLite 状态，
  - 事件日志，
  - 研究导出，
  - Agent 子进程管理，
  - schema 校验，
  - 开发服务器生命周期，
  - 预览 URL/代理，
  - 以及确定性的任务状态。
- Ikran Runtime 不嵌入或实现 Figma MCP。
- Ikran Runtime 应要求所选外部 Agent 环境具备可用的 Figma MCP 访问能力。
- 当 Agent 输出格式错误时，Ikran Runtime 不发明语义内容。
- Ikran Runtime 校验 Agent 输出，并可请求一次修复。
- 如果修复后的输出仍然无效，用户必须重试或切换 Agent。

### 本地安全模型

- Ikran 是本地优先产品，MVP 中不应把项目文件上传到云服务。
- Runtime 默认监听 `127.0.0.1`，不应绑定外部网络地址。
- 有权限的 API 必须要求启动级本地 session token。
- Runtime API 默认只能在用户选择的项目文件夹内操作，除非后续通过明确用户动作扩展范围。
- 浏览器 UI 不得直接访问本地文件系统。
- Agent 执行、文件修改、项目初始化和规则更新应用，必须由明确用户动作或已批准的工作流步骤触发。
- 当 origin、session 或项目范围校验失败时，Runtime 应偏向 fail-closed。

### 外部 Agent

- MVP 使用 headless CLI AgentAdapter。
- 目标外部 Agent 包括 Codex、Claude Code 和 Cursor。
- 未来 adapter 可包括 provider SDK adapter 和 ACP adapter。
- 即便 MVP 不实现完整 ACP，adapter 边界也应保持 ACP 形态。
- Agent 负责：
  - Figma MCP 摄取，
  - 证据包创建，
  - 空间标注和问题卡，
  - 设计系统草稿提取，
  - design-system-view JSON 生成，
  - 种子原型重建，
  - 新原型设计和创建，
  - 规则更新提案生成，
  - 以及设计师确认后的语义文件编辑。
- Agent 的主要工作是设计和原型创建，而不仅仅是代码修改。
- 代码编辑是产出设计/原型结果的实现手段。

### 项目文件夹

- 设计师提供一个空的本地文件夹。
- 文件夹选择应尽量使用操作系统原生文件夹选择器。
- 浏览器 UI 通过 Runtime API 触发文件夹选择；Runtime 拥有原生 dialog，并返回被选中的真实路径。
- 当原生 dialog 不可用时，MVP 提供手动本地路径输入并进行校验。
- 项目开始时，该文件夹预计不包含源代码。
- Agent 在该文件夹中初始化原型 App 和工作流文件。
- 该文件夹成为完整的项目工作空间和研究案例。
- 项目结构应包括：
  - 项目本地 `.ikran/` 元数据，
  - `workflow/design-system/`，
  - `workflow/design-evidence/`，
  - 原型源代码，
  - package manifest，
  - Tailwind 配置，
  - 以及生成的 artifacts。
- Ikran Runtime 将 runtime 和研究元数据存储在 `.ikran/` 下。
- `.ikran/` 内容包括：
  - SQLite App 数据库，
  - JSONL events，
  - config，
  - artifacts，
  - export files。

### 原型技术栈

- 默认生成的原型技术栈：
  - Next.js，
  - TypeScript，
  - Tailwind CSS，
  - npm。
- 默认命令：
  - `npm install`，
  - `npm run dev`。
- Tailwind 是实现语法，而不是设计源。
- `workflow/design-system/token.json` 是设计 token 的事实源。
- `tailwind.config.ts` 是 Agent 根据 token 数据生成的派生实现映射。
- MVP 不要求自动化 token-to-Tailwind 生成脚本。
- 未来版本可用确定性生成替换由 Agent 维护的 Tailwind 映射。
- 默认不要引入外部 UI kit，因为它可能污染从种子提取出的设计语言。

### 预览 Runtime

- MVP 预览 runtime 是对本地开发服务器的 iframe 嵌入。
- Ikran Runtime 启动或检测开发服务器，并暴露稳定的预览 URL。
- 原型浏览应使用实时预览，而不是截图历史。
- 当 Agent 修改本地项目时，iframe 预览应更新。
- 浏览器 UI 应提供 focus mode，用于打开本地预览 URL 以进行完整交互。
- Prototype 区域标注以 iframe 的可视区域选择为入口。
- Runtime 应尽量对同源 iframe 做非侵入式 DOM inspection，补充 selector、id、data 属性、候选 component id、候选元素 bounding box 和 overlap ratio。
- DOM inspection 失败时，prototype 区域标注仍然有效。
- Runtime 可以生成完整 viewport screenshot 和 selected crop 作为 Agent 上下文 artifact，但这些截图不应替代实时 iframe 浏览。
- Sandpack 保留给未来的组件库预览。
- WebContainers 保留给未来的在线统一平台。

### React Flow 工作区与区域标注模型

- React Flow 是研究工作流的空间化投影，不是通用白板工具。
- MVP 的核心画布对象是 Evidence Surface：
  - Figma Evidence Surface：首次 seed extraction 时承载 Figma structured evidence 的可视表面。
  - Prototype Evidence Surface：seed reconstruction 和后续新原型的实时 iframe surface。
- Region Annotation 是一等持久记录，但必须依附于明确的 Evidence Surface。
- 没有 `surfaceArtifactId` 或 `surfaceNodeId` 的 Region Annotation 无效。
- Region Annotation 由 Ikran Runtime 统一校验、补全 ID、落盘并广播给 UI。
- Browser UI 和 Agent 都只能提交 Region Annotation intent。
- Region Annotation overlay 必须支持：
  - 区域框，
  - 编号或短标题，
  - 选中 callout，
  - 与右侧 question / feedback panel 联动。
- Figma 阶段和 prototype 阶段使用两套 anchor schema：
  - `figma-region` anchor 连接 Figma structured evidence、Figma node/component/bounds 和可视 surface 坐标。
  - `prototype-region` anchor 连接 prototype run、iframe viewport 坐标、selected crop 和可用 DOM candidates。
- Figma structured evidence 是 Agent 抽取设计系统和重建 seed prototype 的依据。
- Figma visual surface、完整截图和 selected crop 只用于人类可视化、标注定位、视觉核对和研究回放，不应成为 screenshot-to-code 的主输入。
- 用户在 Figma visual surface 上创建区域标注时，系统应尝试匹配 Figma structured evidence candidates；匹配结果是候选，不是强制唯一绑定。
- Agent 创建 Figma 标注时必须提供 region rect；当标注语义是 single-node 时，必须提供 primary Figma node 或高置信候选。
- Prototype 区域标注必须包含 bounding box 和 normalized rect；DOM selector、component id 和元素 candidates 是可选增强。
- Agent 处理 region annotation 时应收到 region context packet，而不是孤立坐标：
  - Figma region packet 包含局部区域、完整 surface 视觉上下文、Figma candidates 和 structured evidence slice。
  - Prototype region packet 包含局部区域、完整 viewport screenshot、selected crop、prototype run id 和可用 DOM candidates。

### 种子提取 UI

- Agent 是主要的标注和问题发起者。
- 设计师也必须能够创建区域标注，用于回答意图问题或指出 Agent 没有覆盖的局部区域。
- 种子对齐使用五个阶段标签页：
  - Layout，
  - Component Extraction，
  - Interaction Style，
  - Visual Style，
  - Generalizability。
- Agent 在第一次种子对齐 pass 中生成全部五个标签页的问题。
- 每个标签页必须包含二到五张问题卡。
- 种子提取继续前，所有卡片都必须回答。
- MVP 中没有 required 卡和 warning 卡的区别。
- 卡片状态只有：
  - unanswered，
  - answered。
- 每张卡片包括：
  - Agent observation，
  - Agent question，
  - conversation thread，
  - final designer answer。
- 最终回答是完成来源。中间对话可以被记录，但不应产生复杂 UI 状态。
- 每张卡片必须有一个证据锚点：
  - 局部区域，
  - Figma 节点，
  - 或整个 frame。
- 证据锚点必须引用 Region Annotation 或 whole-frame anchor，不能只使用“这里”等模糊描述。
- 标注类型可包括：
  - question，
  - assumption，
  - observed fact，
  - generalization risk。
- 标注类型只是视觉辅助，不影响完成状态。
- 选择问题时，应将画布平移/缩放到对应的证据锚点。
- 初步设计系统抽取完成后，Figma annotations 默认隐藏。
- 用户选择 Figma Evidence Surface，或从 question / answer / research event 回到 Figma evidence context 时，相关 Figma annotations 重新显示。
- 种子提取完成后，主工作区默认切换到根据原 Figma 设计重建完成的 seed prototype iframe surface。

### 设计系统文件

- 遵循 `recursive-design-method` 中的结构。
- 事实源文件包括：
  - `workflow/design-system/design-system-candidate.md`，
  - `workflow/design-system/design-system.md`，
  - `workflow/design-system/token.json`，
  - `workflow/design-system/component-list.md`，
  - `workflow/design-system/component-spec/`，
  - `workflow/design-system/layout-rules.md`，
  - `workflow/design-system/interaction-rules.md`，
  - `workflow/design-evidence/registry.md`。
- 添加一个面向 UI 的派生文件：
  - `workflow/design-system/design-system-view.json`。
- `design-system-view.json` 由 Agent 根据源设计系统文件生成。
- `design-system-view.json` 不是事实源，不应被直接编辑。
- 浏览器 UI 应读取 `design-system-view.json`，用于稳定渲染设计系统页面。
- 自然语言文件仍然必要，因为它们保留语义意图、边界和证据解释。
- 结构化 JSON 仍然必要，因为它稳定了生成式 UI 渲染。
- 这种双层策略让设计系统既能被人阅读，也能被 UI 渲染。

### 设计系统浏览器

- 种子提取完成后，左侧导航不再显示种子提取操作。
- 它改为显示当前设计系统和工作循环入口。
- 设计系统浏览器以阅读为先，由 Agent 编辑。
- MVP 中不提供复杂的手动编辑器。
- 设计系统浏览器包括：
  - Foundations，
  - Components。
- Foundations 包括：
  - Color，
  - Typography，
  - Materials，
  - Layout，
  - Interaction。
- Components 包括：
  - component inventory，
  - component detail pages。
- 不要创建独立的 Rules section。
- 规则、约束、用法边界和示例必须嵌入相关 foundation/component 页面。
- 每个设计系统页面应展示：
  - 语义角色，
  - 视觉样例，
  - 简短用法说明。
- Component detail pages 应展示：
  - 目的，
  - 变体，
  - 状态，
  - token 链接，
  - 以及可用时的预览/示例。
- 设计系统浏览器可以从 Vercel Geist Foundations 的信息架构中获得灵感，但不得复制其视觉身份，除非未来设计明确选择该方向。

### 上下文规则更新 UI

- 每个设计系统页面都可以显示一个小型 Agent 侧栏。
- 侧栏应有一个输入框和一个轻量指令提示。
- UI 不应显示 current token context、evidence package 或 rule-update task state 等内部上下文名称，除非用户明确展开技术细节。
- 用户在查看相关设计系统页面时，应能够请求修改。
- 从技术上讲，每次设计系统修改仍然通过 rule-update 运行。
- 从产品上看，rule-update 表现为上下文中的 Agent 编辑。
- Agent 返回一个 Update Proposal。
- 提案展示：
  - 将改变什么，
  - 为什么改变，
  - 受影响项，
  - Confirm，
  - Cancel。
- 已确认的变更通过 Agent 在 Runtime 编排下应用。
- 已取消的变更不会修改事实源文件。

### 新原型创建

- 种子提取和初始设计系统形式化之后，主循环变成：
  - 创建新原型，
  - 审查它，
  - 更新规则，
  - 创建下一个原型。
- 人类意图优先创建是主要路径。
- 视觉参考输入是可选的。
- Agent 在本地项目中创建原型设计和实现。
- 原型应通过实时 iframe 预览展示。
- 每个生成结果应在 React Flow 工作区中表现为 Prototype Evidence Surface。
- 设计师和 Agent 可以对整个 prototype surface 或局部 prototype region 提供反馈。
- 新原型创建应消费设计系统，而不是只依赖 prompt memory。

### 规则递归

- 规则递归发生在原型反馈、设计系统页面反馈或审查发现之后。
- 反馈由 Agent 分类为：
  - 页面局部例外，
  - 可复用候选，
  - 与已确认规则冲突，
  - 开放缺口，
  - 拟议设计系统更新，
  - 未发现。
- MVP 应支持提案和确认应用流程。
- 设计师仍是最终决策者。
- 系统应偏好最小有效更新。
- 除非必要，应避免复杂规则更新。

### 数据与研究日志

- 使用 SQLite 进行系统状态和事件索引。
- 使用 JSONL 作为可导出的事件日志。
- 使用项目本地 artifact 文件存放源输出和生成输出。
- 事件日志使用语义事件粒度，而不是完整 UI 行为记录。
- 记录有意义的设计对齐事件，例如：
  - 项目创建，
  - 文件夹已选择，
  - Agent task started，
  - Figma evidence package returned，
  - annotation created，
  - region selected，
  - question card created，
  - designer answer submitted，
  - seed extraction stage completed，
  - draft design-system generated，
  - design-system-view generated，
  - seed reconstruction started，
  - preview started，
  - new prototype run created，
  - prototype region feedback submitted，
  - rule-update proposal created，
  - rule-update confirmed，
  - rule-update canceled，
  - export generated。
- 不要将每次画布平移、缩放、hover 或文本击键记录为研究事件。
- 原型运行应链接到影响它们的回答和设计系统版本。
- Prototype feedback 应同时链接 prototype run、prototype surface，以及可选 region annotation。
- 规则更新应链接到触发它们的反馈或页面上下文。

### 研究导出

- 在 `.ikran/export/` 中提供最小研究导出包。
- 导出 JSON/JSONL，而不是可视化分析 dashboard。
- 建议导出文件：
  - `events.jsonl`，
  - `project-summary.json`，
  - `alignment-questions.json`，
  - `designer-answers.json`，
  - `prototype-runs.json`，
  - `rule-update-proposals.json`，
  - `artifacts-index.json`。
- 工作流文件、证据注册表和原型源代码也是可复现研究 artifact 的一部分。

### Agent 任务契约

- 定义浏览器 UI、Ikran Runtime 和 Agent 之间稳定的任务/结果契约。
- MVP 任务族：
  - Project setup task，
  - Generate seed alignment questions task，
  - Draft design system task，
  - Reconstruct seed prototype task，
  - Generate design-system view task，
  - Create new prototype task，
  - Rule update task，
  - Export research package task。
- Agent 输出必须进行 schema 校验。
- 无效输出触发：
  - invalid-output event，
  - 一次修复请求，
  - 如果成功，则触发 repaired-output event。
- Runtime 不应静默截断、发明或重新解释设计语义。

## 测试决策

- 最高价值的测试边界是完整工作流边界：浏览器 UI -> Ikran Runtime -> mocked AgentAdapter -> 项目 artifacts -> 浏览器 UI render。
- 偏好一个高层集成边界，而不是许多低层测试，因为 MVP 风险在于工作流协调，而不是孤立 helper function。
- 测试应验证外部行为和持久输出，而不是实现细节。

### 主要测试边界

- 使用 mocked AgentAdapter，返回确定性的证据、问题卡、设计系统文件、预览状态、原型运行元数据和规则更新提案。
- 让浏览器 UI 连接由同一个本地 Ikran Runtime 托管的测试实例运行。
- 使用一个临时空项目文件夹。
- 验证 App 可以在没有真实 Agent 或真实 Figma MCP 的情况下完成研究工作流。

### 待测试模块

- 浏览器 UI 种子提取流程：
  - 阶段标签页渲染，
  - 问题卡渲染，
  - 所有卡片要求最终回答，
  - 选中的问题聚焦证据锚点，
  - React Flow surface 渲染，
  - Region Annotation overlay 渲染和选中 callout，
  - 完成门禁只在所有卡片回答后打开。
- Ikran Runtime API：
  - 项目文件夹校验，
  - 任务创建，
  - SSE events，
  - Agent result validation，
  - one-pass repair behavior，
  - event persistence，
  - export generation。
- AgentAdapter 契约：
  - headless CLI adapter 可被 mock adapter 替代，
  - 任务/结果 schema 保持稳定。
- 项目 artifact 生成：
  - `.ikran/` 元数据被创建，
  - `workflow/design-system/` 被创建，
  - `workflow/design-evidence/registry.md` 被创建，
  - `design-system-view.json` 被创建且可渲染。
- 设计系统浏览器：
  - Foundations 页面从 `design-system-view.json` 渲染，
  - Components 页面从 `design-system-view.json` 渲染，
  - 不需要独立 Rules 页面，
  - Agent 侧栏可以创建更新提案。
- 预览生命周期：
  - 开发服务器 readiness 反映在 UI 中，
  - iframe 接收预览 URL，
  - focus mode 打开预览 URL，
  - prototype region selection 可以产出 bounding box、normalized rect、selected crop 和可用 DOM candidates。
- 规则更新：
  - 提案被生成，
  - Confirm 通过 mocked Agent flow 应用变更，
  - Cancel 不应用任何变更，
  - 事件日志记录两条路径。
- 研究导出：
  - JSON/JSONL 导出文件被生成，
  - 导出的文件包含已链接的项目、问题、回答、原型和规则更新标识符。

### 手动/真实集成检查

- 真实 Figma MCP 摄取应使用已配置的外部 Agent 环境手动测试。
- 真实 Codex、Claude Code 和 Cursor CLI adapter 可以逐个 smoke-test。
- 应使用真实种子页面验证 Figma 视觉证据和结构化证据能够产出卡片锚点。
- 应使用真实种子页面验证 Agent 的设计系统抽取和 seed prototype 重建依赖 Figma structured evidence，而不是截图转代码。
- 应使用真实空项目文件夹验证 Next.js/TypeScript/Tailwind/npm 初始化和预览启动。
- 视觉和交互验收应验证种子重建原型可以通过实时预览使用。

## 范围外

- 多项目工作空间管理。
- 多用户协作。
- 通用 tldraw / Miro 式自由白板。
- 云托管 runner。
- 云端 Web App 加本地 companion Runtime 的产品形态。
- 完整 ACP 实现。
- 完整 WebContainers runtime。
- Sandpack 组件库预览。
- 浏览器内 IDE 或代码编辑器。
- 浏览器 UI 直接访问本地文件系统。
- Ikran Runtime 实现 Figma MCP。
- 用 App 内模型 runtime 替换外部编码 Agent。
- 复杂设计系统手动编辑器。
- 独立 Rules 页面。
- 种子提取重跑或种子替换。
- 从新种子/参考混合设计语言。
- 基于截图的原型浏览。
- 基于截图生成 seed prototype。
- 完整可视化分析/报告 dashboard。
- 完整确定性 token-to-Tailwind 生成脚本。
- Recursive Design Method 工作流以外的通用 App 生成。
- 生产级 packaging、installer、团队 auth 或 billing。
- 生产级桌面应用打包。

## 进一步说明

像可扩展的 Agent-design platform 一样做战略思考，但像一个月研究工具一样做战术构建。MVP 应该快速、可用，并且足够完整以支持实验，同时为 ACP、Sandpack、WebContainers、设计语言混合和更丰富的规则递归留下清晰边界。
