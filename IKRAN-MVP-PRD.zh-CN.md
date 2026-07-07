# Ikran MVP PRD（中文）

状态：ready-for-agent
目标：一个月内可用的研究原型
日期：2026-07-07
标准：本文是 Ikran MVP 的唯一产品标准；issues 应只依赖本文。

## Problem Statement

使用 agentic 设计工作流的设计师已经可以让编码 Agent 产出原型，但交互仍然过于依赖聊天文本，也过于脱离设计画布。当 Agent 不理解一个 Figma 种子页面时，设计师必须从聊天线程中推断 Agent 到底困惑在哪里。这会让设计意图对齐变慢、难以审计，也难以沉淀成持久的设计系统。

现有的 Recursive Design Method 已经定义了正确工作流：从 Figma 种子页面开始，对齐意图，提取一个设计师和 Agent 都能阅读的设计系统，将种子重建为交互式原型以验证代码、视觉和语义一致性，然后使用生成的设计系统创建新原型，并递归更新规则。现在缺少的是一个本地优先、空间化、可记录研究数据的 Ikran workbench。

原 PRD 计划让 Ikran Runtime 自己 spawn headless CLI Agent。真实 smoke 显示这条产品路径太重：每个 CLI Agent 都要单独配置 Figma MCP、token、权限、视觉模型和交互授权，且很难稳定返回 schema-valid output。Ikran 不应该复制 Agent host 已经拥有的模型、工具、Figma MCP 和权限系统。

MVP 必须在一个月内成为完整闭环的研究原型。它必须支持：

- Figma seed reference 和原始设计意图登记。
- Agent host 使用自己的 Figma MCP 摄取 seed evidence。
- Ikran Runtime 记录 canvas record、事件、校验和派生 artifact。
- Ikran workbench 提供 tldraw 空间画布、Evidence Surface、Region Annotation、Question card 和 preview。
- 设计系统 source artifact 和 prototype code 保存在项目文件夹内。
- 新原型创建和规则递归。
- JSON/JSONL 研究导出。

产品在第一个月不能变成完整 IDE、Figma 替代品、MCP App 内联 UI、通用白板、云端协作平台，或通用 AI App 生成器。它应该是一个单项目、单流程的本地研究 workbench，用于递归式设计师-Agent 对齐。

## Solution

Ikran 以融合形态存在：一个本地 Ikran Runtime daemon 同时提供两个 surface：

- Agent ↔ Runtime：传统 MCP over stdio。Agent host spawn Runtime，并调用语义 MCP tools。
- Designer ↔ Runtime：HTTP Web UI，即 Ikran workbench。Runtime 绑定 `127.0.0.1` 自动端口，生成启动级 session token，并返回 Workbench URL。

设计师通过自然语言让 Agent 打开 Ikran。Agent 调用 `open_workbench`，Runtime 启动或复用 HTTP surface，并返回类似下面的 URL：

```text
http://127.0.0.1:{port}/?session={token}
```

Agent 把 Workbench URL 返回给设计师。设计师可以在任意浏览器打开它；理想环境是 Agent host 的嵌入式浏览器，因为 chat、MCP tool、宿主文件编辑和空间 workbench 会处在同一工作环境内。

Ikran workbench 提供：

- tldraw 画布。
- stage tabs。
- 左侧 question list。
- Question card，卡上输入 final designer answer。
- Figma Evidence Surface。
- Prototype Evidence Surface，使用 live iframe preview。
- Region Annotation custom shape。
- 设计系统浏览器。
- 规则更新提案确认流。
- 最小研究导出操作。

Agent host 的 chat pane 保留为多轮澄清、指令沟通和 Agent 解释空间。Ikran workbench 不再提供右侧通用 chat 面板。

Ikran Runtime 负责：

- MCP tool handlers。
- HTTP REST API 和 SSE。
- Workbench URL 与启动级 session token。
- 项目绑定和 `.ikran/` 元数据。
- SQLite 状态和事件索引。
- JSONL event log。
- canvas record 校验、ID 分配、持久化和广播。
- source artifact declaration 校验。
- derived artifact 生成。
- prototype preview lifecycle。
- DOM inspection 可用版。
- 研究导出。

Agent host 负责：

- 模型推理。
- Figma MCP 摄取。
- 设计解释。
- evidence package 生成。
- 问题和标注提出。
- design-system source artifact 写入。
- prototype code 写入。
- rule update proposal 生成。
- 通过 Ikran MCP tools declare 语义结果。

Ikran Runtime 零 Figma 接触。Runtime 只逐字保存 seed reference，并校验 Agent 通过宿主 Figma MCP 返回的 evidence package。

## Product Standard

本文是实现、拆 issue、验收和研究 smoke 的唯一标准。任何 issue、agent handoff 或实现计划都不应要求读取其他设计记录才能知道产品边界。其他设计记录只保留为历史背景；若其他设计记录与本文冲突，以本文为准。

Ikran 的核心不变量：

1. Runtime-owned semantic records 是研究事实源。
2. tldraw geometry 不是事实源，也不是研究数据。
3. Agent host 负责模型、Figma MCP、工具审批和源文件编辑。
4. Ikran Runtime 负责 MCP tools、Workbench、记录、校验、preview、derived artifacts 和 export。
5. Ikran Runtime 零 Figma 接触。
6. Source artifact 只有声明并校验通过后才进入事件、artifact index、derived artifact 和 export。
7. Workbench 是空间化结构表面，不是 chat，也不是通用白板。

### 为什么采用 Agent Host + MCP + Workbench URL

原 headless CLI 路径看起来让 Ikran 更独立，但真实接入暴露出逐 Agent 集成税：Figma MCP config、token、权限、视觉模型、交互授权和 schema-valid output 都要为每个 CLI Agent 单独处理。Ikran 本质仍依赖其他 Agent，却承担了宿主本来已经拥有的模型和工具集成复杂度。

新的产品形态把沉重的 Figma MCP、模型、权限和文件编辑能力交给 Agent host。Ikran 专注于画布、semantic records、事件、preview、校验和研究导出。这让 MVP 更轻，也更符合一个月研究原型的目标。

传统 MCP + HTTP Workbench 不依赖 MCP Apps inline UI，因此不会被宿主是否支持 MCP App 渲染卡住。Cursor 可作为优先真实 host；Codex Desktop 的 MCP tool 暴露能力需要持续 smoke，如果受宿主 bug 影响，记录 open gap 和 fallback。

### 被否决的产品路径

- 独立 `npx ikran` 打开自己浏览器并由 Runtime spawn headless CLI Agent：逐 Agent 配 Figma MCP、token、权限和视觉模型太重，作为 MVP 产品路径废弃。
- MCP Apps inline UI：依赖宿主渲染支持，且 chat 内联视口不适合承载 Ikran 的空间画布。
- Runtime 代理 source artifact 写入：重复 Agent host 原生文件编辑能力，DX 差；改为 Agent host 写源文件、Runtime 接受声明并校验。
- tldraw shape-store-as-source 或 raw exec：会绕过 Runtime 接受前校验，破坏研究事实源。
- React Flow 作为 MVP 画布底座：React Flow 仍可作为未来工作流 graph 需求变强时的备选，但 MVP 采用 tldraw，因为 Evidence Surface、live iframe preview 和 custom annotation shape 是核心。
- HTTP MCP transport：会重新引入端口/token/CORS 和第二进程问题；MVP 采用 stdio MCP + localhost HTTP Workbench 两 surface。

### 迁移后果

需要退役或不再作为产品路径推进：

- headless CLI AgentAdapter 产品路径。
- hardened headless CLI issue 路径。
- real headless CLI Figma smoke 作为最终验证路径。
- Runtime Figma validate/oEmbed/API 接触面。
- React Flow seed/evidence canvas layer。
- raw geometry tool 或 shape-store-as-source 模型。

需要保留并迁移：

- Next.js Workbench。
- HTTP REST API 和 SSE。
- session token。
- project binding 和 `.ikran`。
- SQLite、event log、schema validation。
- mocked path 和 deterministic e2e 测试。
- task lifecycle 中可复用的状态、事件和校验思想。
- setup/Enter Panel 中仍符合 Figma 参考的 UI 部分。

## User Stories

1. 作为设计师，我想通过自然语言让 Agent 打开 Ikran，以便我不需要理解 Runtime 启动细节。
2. 作为设计师，我想让 Agent 返回一个 Workbench URL，以便我可以直接进入 Ikran workbench。
3. 作为设计师，我想在 Agent host 的嵌入式浏览器中打开 Workbench URL，以便 chat、文件编辑和画布保持在同一个工作环境内。
4. 作为设计师，我想在普通系统浏览器中也能打开 Workbench URL，以便嵌入式浏览器不可用时仍可工作。
5. 作为设计师，我想从一个 Figma seed reference 开始项目，以便从已有源设计中提取设计语言。
6. 作为设计师，我想输入原始设计意图，以便 Agent 理解种子页面要表达的目标，而不只看结构。
7. 作为设计师，我想选择一个本地项目文件夹，以便 Ikran 的状态、设计系统和 prototype code 都可移植可审计。
8. 作为设计师，我想让 Agent 使用宿主已有的 Figma MCP 摄取 seed evidence，以便避免在 Ikran 内重新配置 Figma token 和权限。
9. 作为设计师，我想看到 Figma Evidence Surface，以便在视觉上下文中理解 Agent 的观察和问题。
10. 作为设计师，我想让 Agent 创建 Region Annotation，以便 Agent 暴露自己在哪里不确定或正在做假设。
11. 作为设计师，我想自己也能创建 Region Annotation，以便补充 Agent 没覆盖到的局部区域。
12. 作为设计师，我想让每个 Region Annotation 锚定到明确的 Evidence Surface，以便研究记录不会出现无上下文的“这里”。
13. 作为设计师，我想让标注类型在视觉上区分 question、assumption、observed fact 和 generalization risk，以便快速扫描对齐状态。
14. 作为设计师，我不希望标注类型改变完成规则，以便卡片状态保持简单。
15. 作为设计师，我想让种子对齐按 Design principle、Visual language、Token、Layout、Component 和 Interaction 六部分进行，以便覆盖对设计结果影响最大的意图维度。
16. 作为设计师，我想让每个阶段包含二到五张 Question card，以便流程有足够深度但不过载。
17. 作为设计师，我想让所有 Question card 都必须有 final designer answer，以便 seed extraction 没有遗漏的对齐维度。
18. 作为设计师，我想在 Question card 上输入最终答案，以便研究数据有明确的设计师结论。
19. 作为设计师，我想在 Agent host chat 中进行开放澄清，以便复杂讨论不挤进卡片 UI。
20. 作为设计师，我想让 Question card 记录 Agent observation、Agent question、conversation thread 和 final designer answer，以便后续能审计对齐过程。
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
46. 作为研究者，我想记录 project creation、seed reference、evidence package、annotation、question、answer、preview、prototype run、feedback、proposal 和 export 等语义事件，以便分析设计意图如何协商。
47. 作为研究者，我不想记录每次 pan、zoom、hover 或文本击键，以便数据聚焦语义对齐而不是 UI 噪声。
48. 作为研究者，我想让 prototype run 和 rule update 链接回相关 question、answer、design-system version 和 Region Annotation，以便研究输出可追溯。
49. 作为研究者，我想导出 JSON/JSONL 包，以便在 Ikran 外分析实验数据。
50. 作为研究者，我想让未声明 source artifact 不进入研究导出，以便导出不会假装拥有未记录的语义。
51. 作为实现者，我想让 Runtime 同时提供 MCP stdio surface 和 HTTP Workbench surface，以便一进程承担两条交互路径。
52. 作为实现者，我想让 Runtime 只绑定 localhost 并用启动级 session token 保护 Workbench URL，以便本地能力不暴露给任意网页。
53. 作为实现者，我想让 MCP tools 和 Workbench HTTP API 共享同一个 project/session 上下文，以便 Agent 和设计师操作同一组记录。
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
64. 作为实现者，我想保留 mocked path，以便没有真实 Figma MCP 或真实 Agent host 时也能完成端到端测试。
65. 作为实现者，我想优先在 Cursor 做真实 Agent host smoke，并观察 Codex Desktop MCP tool 暴露问题，以便产品路径有务实 fallback。
66. 作为产品负责人，我想保持单项目单流程，以便一个月 MVP 受控。
67. 作为产品负责人，我想避免 MCP Apps inline UI 依赖，以便不被宿主渲染能力卡住。
68. 作为产品负责人，我想保留未来桌面打包可能性，以便不重写 Runtime 和 Workbench 核心。

## Implementation Decisions

- 产品正式名称是 Ikran。
- MVP 必须在一个月内成为完整闭环研究原型，而不是只覆盖 seed extraction 的局部工具。
- MVP 是单项目、单流程。不支持多项目、多用户协作或分支。
- Ikran 采用传统 MCP + HTTP Workbench + tldraw，退役独立本地 app + headless CLI 产品路径。
- Ikran Runtime 是一个本地 daemon，一进程两 surface：stdio MCP server 和 HTTP Workbench server。
- Agent host 是 Cursor 或 Codex Desktop 等桌面 coding-Agent 应用。它拥有模型、Figma MCP、工具审批和文件编辑能力。
- Workbench URL 由 `open_workbench` 返回，包含 localhost 自动端口和启动级 session token。
- Workbench URL 可在任意浏览器打开；理想环境是 Agent host 的嵌入式浏览器。
- Runtime 只绑定 `127.0.0.1`，不开放宽泛 CORS。
- session token 随 Runtime 启动生成，关闭 Runtime 后失效。
- Workbench URL 不是公开 URL，不支持远程协作或跨设备访问。
- MCP tools 与 Workbench HTTP API 共享同一个 project/session 上下文。

### 最小 MCP 工具面

- `open_workbench`：启动或复用 Runtime HTTP surface，返回 Workbench URL。
- `create_or_open_project`：绑定单项目工作区和 `.ikran` 状态。
- `register_seed_reference`：记录 Figma seed URL 和原始设计意图。
- `record_evidence_package`：Agent 用宿主 Figma MCP 摄取后声明 evidence package。
- `create_evidence_surface`：创建 Figma 或 Prototype Evidence Surface 的 canvas record。
- `create_region_annotation`：创建锚定到 Evidence Surface 的 Region Annotation。
- `create_question_card`：创建带观察、问题、anchor 和阶段信息的 Question card。
- `record_designer_answer`：记录卡片上的 final designer answer。
- `record_artifact_written`：Agent 写 source artifact 后声明路径、类型、语义目的和关联记录。
- `record_preview`：声明或更新 prototype preview/run 与对应 Evidence Surface。
- `propose_rule_update`：记录 rule update proposal，等待设计师确认。
- `export_research_package`：生成研究导出。

### Workbench 与画布模型

- 使用 Next.js 构建 Ikran workbench。
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

### Evidence Surface 与 Region Annotation

- Evidence Surface 是设计师和 Agent 共同推理的画布对象。
- Figma Evidence Surface 用于 seed evidence 可视化。
- Prototype Evidence Surface 用于 live iframe preview。
- Region Annotation 是一等持久记录，必须锚定到明确 Evidence Surface。
- 没有 `surfaceArtifactId` 或 `surfaceNodeId` 的 Region Annotation 无效。
- Figma 阶段使用 `figma-region` anchor。
- Prototype 阶段使用 `prototype-region` anchor。
- Figma single-node 语义必须包含 primary Figma node 或高置信 candidate。
- Prototype region 必须包含 bounding box 和 normalized rect。
- DOM selector、component id 和 element candidates 是 prototype region 的可选增强。
- 标注类型是视觉辅助，不影响 Question card 完成规则。

### Figma 接触面

- Ikran Runtime 不嵌入、不实现、不代理 Figma MCP。
- Figma ingestion 完全发生在 Agent host 的 Figma MCP 环境内。
- Runtime 逐字保存 seed reference。
- Agent 必须通过 Ikran tool 声明 evidence package。
- Runtime 校验 evidence package schema，但不直接访问 Figma。
- Figma visual surface、截图和 crop 用于人类可视化、定位和研究回放，不应替代 structured evidence 成为 seed prototype 的主要输入。

### 项目文件夹与 artifact

- 设计师提供一个本地项目文件夹。
- 项目文件夹成为完整研究案例：`.ikran/`、workflow 文件、source artifact、derived artifact、prototype code 和 export 共存。
- `.ikran/` 存放 Runtime 元数据、SQLite、event log、config、artifact index 和 export。
- Source artifact 是 Agent 通过 Agent host 原生文件编辑写入的事实源项目文件，例如 design-system markdown、`token.json`、component specs 和 prototype code。
- Derived artifact 是 Runtime 从 source artifact 生成的文件，例如 `design-system-view.json` 和 research export。
- Runtime 不代理 source artifact 写入。
- Agent 写 source artifact 后必须调用 `record_artifact_written`。
- 已声明且校验通过的 source artifact 进入事件日志、artifact index、derived artifact 生成和研究导出。
- 已写入但未声明的文件变化最多作为 warning/open gap，不自动进入事实源。
- 声明后校验失败时，Runtime 记录 invalid-output/invalid-artifact 事件，可请求一次修复；修复仍失败时不补造语义。

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

- Seed extraction 只在项目启动时执行一次。
- 如果需要不同 seed，用户创建新项目。
- 种子对齐使用六部分 Design Intent Alignment：Design principle、Visual language、Token、Layout、Component、Interaction。
- Content style observations 不作为 MVP 必答阶段，也不能阻塞 seed extraction。
- Agent 在第一次 pass 中生成所有阶段的问题。
- 每个阶段二到五张 Question card。
- 所有 Question card 都必须有 final designer answer 后才能继续。
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
- Confirm 后 Agent 写 source artifact 并声明；Cancel 不修改 source artifact。

### Data 与 Research Export

- Runtime 使用 SQLite 进行状态和事件索引。
- Runtime 使用 JSONL 作为可导出的 event log。
- 事件粒度是语义动作，不记录低层 UI 噪声。
- 必须记录 project creation、folder selection、seed reference、evidence package、Evidence Surface、Region Annotation、Question card、designer answer、design-system artifact、preview、prototype run、feedback、rule proposal、confirm/cancel 和 export。
- Prototype run 和 rule update 必须尽量链接回相关 question、answer、design-system version、Evidence Surface 和 Region Annotation。
- Research export 输出到 `.ikran/export/`。
- 最小导出包括 `events.jsonl`、`project-summary.json`、`alignment-questions.json`、`designer-answers.json`、`prototype-runs.json`、`rule-update-proposals.json` 和 `artifacts-index.json`。

## Testing Decisions

最高价值测试边界是完整工作流边界：

```text
Workbench -> Runtime HTTP/SSE -> Runtime MCP tool handlers -> mocked Agent/tool caller -> project artifacts -> Workbench render/export
```

测试应验证外部行为、持久记录和导出结果，而不是实现细节。MVP 风险在于跨 surface 工作流协调、事实源边界和 artifact 声明，而不是孤立 helper function。

- 使用 Playwright 做 Workbench 端到端测试。
- 使用 mock MCP client 直接打 MCP tool handlers。
- 使用临时项目文件夹验证 `.ikran/`、source artifact declaration、derived artifact 和 export。
- 使用 deterministic mocked Agent/tool caller 覆盖没有真实 Figma MCP 和真实 Agent host 的完整研究工作流。
- 继续保留 mock adapter 的测试价值，但 headless CLI adapter 不再是产品路径。

### 必测行为

- `open_workbench` 返回 localhost Workbench URL，URL 包含 session token。
- Workbench URL 可在浏览器打开。
- 缺失或错误 session token 被拒绝。
- MCP tools 和 Workbench HTTP API 操作同一个 project/session。
- Runtime 能创建并恢复 `.ikran/` project state。
- `register_seed_reference` 只保存 seed reference，不访问 Figma。
- `record_evidence_package` 校验 evidence package，并创建 Figma Evidence Surface。
- tldraw shape 能投影 canvas record，shape id 不成为语义事实源。
- Region Annotation 必须包含 surface anchor。
- Question card 必须包含 anchor、Agent observation、Agent question 和 final answer。
- 所有 Question card answered 后才允许 seed extraction 继续。
- `record_artifact_written` 后 Runtime 记录事件、校验 source artifact，并生成 derived artifact。
- 未声明 source artifact 不进入 research export。
- Preview readiness 能反映到 Workbench。
- Prototype Evidence Surface 能嵌入 live iframe。
- Prototype region selection 能产出 bounding box、normalized rect、selected crop 和可用 DOM candidates。
- Rule update proposal 支持 Confirm 和 Cancel；Cancel 不修改 source artifact。
- Research export 包含事件、问题、回答、prototype run、rule proposal 和 artifact index。

### 手动真实 smoke

- Cursor 能发现 Ikran MCP tools，并通过 `open_workbench` 返回 Workbench URL。
- Workbench URL 能在 Cursor 嵌入式浏览器打开；复制到系统浏览器也能打开。
- Codex Desktop MCP tool 暴露需要 smoke 验证；若受 `openai/codex#26659` / `#26072` 影响，记录 fallback。
- Agent host 能使用自己的 Figma MCP 摄取真实 seed evidence，并通过 Ikran tool 声明。
- Runtime 不接触 Figma。
- Agent 能写 source artifact，并通过 `record_artifact_written` 声明。
- 真实空项目文件夹能初始化 Next.js/TypeScript/Tailwind/npm prototype。
- Live iframe preview 和 focus mode 能手动使用。
- tldraw Evidence Surface、Region Annotation 和 semantic record id 能回连。

## Out of Scope

- 独立 `npx ikran` 打开自己浏览器并 spawn headless CLI Agent 的产品路径。
- Hardened headless CLI AgentAdapter 作为 MVP 产品路径。
- MCP Apps inline UI。
- Ikran Runtime 实现或代理 Figma MCP。
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
- 种子提取重跑或 seed 替换。
- 从多个 seed 混合设计语言。
- 基于截图生成 seed prototype。
- 截图历史替代 live iframe preview。
- 完整可视化分析 dashboard。
- 生产级 packaging、installer、团队 auth 或 billing。

## Further Notes

Ikran 的战略方向是成为递归式 designer-Agent alignment workbench；MVP 的战术边界是一个月内完成本地、单项目、可研究闭环。所有实现都应优先保护三件事：

1. Runtime-owned semantic records 是事实源。
2. Agent host 负责 Figma、模型和文件编辑；Ikran 负责记录、校验、preview 和导出。
3. Workbench 是空间化结构表面，不是另一个 chat，也不是通用白板。

`Issues 02/` 是按本文重排的新 issue 组。旧 `issues/` 中的 Issue 14 headless CLI 产品路径废弃，Issue 16 改为 Agent host MCP smoke，Issue 04/07 的画布基础从 React Flow 改为 tldraw，并新增 Workbench URL 启动协议的竖切。
