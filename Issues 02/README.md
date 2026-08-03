# Ikran MVP Issues 02

来源：`IKRAN-MVP-PRD.zh-CN.md`，并对照旧 `issues/` 重排。PRD 是唯一产品标准；issue 执行不需要读取其他设计记录。当前架构收口见 ADR 0002、ADR 0003 与 ADR 0004。

这些 issue 是 tracer-bullet vertical slices，覆盖从历史项目状态迁移到 Agent host + MCP + Workbench URL + tldraw 产品形态。每个阶段都有真实 Agent 接入点，不把真实验证集中到项目末尾。

历史完成报告保留原文；若实现细节已被后续架构收口替代，以 PRD + ADR 0002/0003 与各 issue 顶部的后续架构收口说明为准，不要把旧报告读成当前 Active 契约。

## 依赖顺序

1. `01-runtime-workbench-url-session-shell.md` - Runtime Workbench URL 与 Session Shell
2. `02-project-session-binding-ikran-metadata.md` - Project Session Binding 与 `.ikran` 迁移
3. `03-semantic-mcp-tool-boundary-mock-client.md` - Semantic MCP Tool Boundary 与 Mock Client
4. `04-tldraw-workbench-shell-seed-entry.md` - tldraw Workbench Shell 替换 React Flow Seed Entry
4A. `04A-retire-legacy-seed-entry-chain.md` - Retire Legacy Seed Entry Chain
5. `05-agent-host-figma-evidence-declaration.md` - Agent-Host Figma Evidence Declaration
5A. `05A-figma-connection-gate-paste-capture.md` - Figma Connection Gate 与 Paste-to-Surface
5B. `05B-seed-reference-collection-agent-parity.md` - Seed Reference Collection 与 Agent Parity
5C. `05C-evidence-refresh-figma-context-handoff.md` - Evidence Refresh 与 Figma Context Handoff
5D. `05D-retire-agent-evidence-real-smoke.md` - 退役 Agent-Supplied Evidence 与真实转型 Smoke
6. `06-evidence-surface-region-annotation-slice.md` - Evidence Surface 与 Region Annotation Vertical Slice
7. `07-design-intent-alignment-six-part-gate.md` - 六部分 Design Intent Alignment Gate
7A. `07A-runtime-owned-alignment-handoff.md` - Runtime-owned Next phase 与 Alignment Preparation
7B. `07B-agent-command-alignment-preparation.md` - Agent command 驱动六部分 Alignment Preparation
7C. `07C-adaptive-agent-wait-workbench-presence.md` - 三分钟 Adaptive Agent Wait 与 Workbench Presence
7D. `07D-alignment-attempt-abandon-regenerate.md` - 返回 Seed Reference、废弃 Attempt 与重新生成问题
7E. `07E-complete-initial-design-system-handoff.md` - Complete 与 Initial Design System Preparation Handoff
7F. `07F-agent-host-activation-feasibility-spike.md` - Agent Host Activation Feasibility Spike
7G. `07G-alignment-command-real-agent-smoke.md` - Alignment Command Staged Real-Agent Smoke
8. `08-source-artifact-declaration-validation.md` - Source Artifact Declaration 与三类校验
9. `09-draft-design-system-derived-view.md` - Draft Design System 与 Derived View JSON
9A. `09A-design-system-browser-v1-form-and-source.md` - Design System Browser v1 形态与全 JSON 源
9B. `09B-initial-design-system-extraction-completeness.md` - Initial Design System Extraction Completeness 与 Semantic Coverage Gate
9C-A. `09C-A-design-system-reader-projection-resizable-split.md` - Design System Reader Projection 与可拖拽双栏
9C-C. `09C-C-visual-coverage-adapters-curated-overrides.md` - Visual Coverage、Component Adapters 与 Curated Overrides
9C-D01. `09C-D01-interaction-section-text-only-strategy-rules.md` - Interaction Section 纯文本策略规则与抽取契约拆分
9C-D02. `09C-D02-layout-source-capture-visual-anchor.md` - Layout Source Capture：原设计截图作为视觉 Anchor
9C-D03. `09C-D03-component-reader-presentation-framework.md` - Component Reader 与统一呈现框架（含组件绑定交互规格）
10. `10-seed-prototype-preview-record-preview.md` - Seed Prototype Preview 与 `record_preview`
11. `11-prototype-region-context-dom-inspection.md` - Prototype Region Context 与 DOM Inspection
12. `12-rule-update-proposal-confirm-cancel.md` - Rule Update Proposal Confirm/Cancel
13. `13-human-intent-new-prototype-loop.md` - Human-Intent New Prototype Loop
14. `14-optional-visual-reference-new-prototype.md` - Optional Visual Reference New Prototype Path
15. `15-research-event-export-undeclared-artifact-guard.md` - Research Event Export 与 Undeclared Artifact Guard
16. `16-staged-full-workflow-smoke-harness.md` - Staged Full Workflow Smoke Harness

## Post-MVP host adapter investigation

17. `17-codex-app-server-activation-adapter-prototype.md` - Codex App Server Activation Adapter Prototype（不进入 MVP blocking path）

## MCP 契约通道

18. `18-mcp-instructions-contract-channel-split.md` - MCP Instructions 通道切分：行为底线、流程契约与方法论归属

ADR 0003 转型的实际 frontier 是：`05A → 05B → 05C → 06 → 05D → 07`。05C 先交付 structural overlay、refresh correspondence 与 context lookup；Issue 06 再建立持久 surface/node/region Annotation 和 stale warning；05D 完成 legacy contract 后，Issue 07 才进入正式 Alignment gate。

Issue 01–05 与 Issue 06 的既有代码/历史材料已存在；阅读时先看各文件顶部的架构收口说明。Issue 05A–05D 与 07–16 同步的是目标与验收，不表示已实现完成。

## 全局约束

- Ikran Runtime 是**一进程**两 surface：stdio MCP + custom Next HTTP/SSE Workbench；MCP 与 HTTP 共享 command kernel，MCP 不 loopback HTTP。
- Workbench URL 可在任意浏览器打开，理想环境是 Agent host 的嵌入式浏览器。
- Runtime 只绑定 localhost，Workbench URL 使用启动级 session token。
- Runtime 通过安装级 Figma Connection 只捕获 positional evidence；实现级 Figma context 由 Agent 按需通过宿主 Figma MCP读取。
- 未连接时显示 Figma Connection Panel 并锁定画布；MVP 使用 PAT + macOS Keychain，OAuth/多账户为 Future Work。
- Seed Reference 支持 Workbench paste 与 Agent tool 双 initiator，共享 command、canonical identity 与原子 capture；一个项目可有多个同设计语言 References。
- tldraw shape 只是 canvas record 投影；Runtime semantic records 是事实源。
- Evidence append-only，经 lineage（`superseded_by` / `current_surface_id`）表达当前证据；Seed Reference 使用 canonical `file_key` / normalized `node_id`，重复提交不重复创建，显式 Refresh 才追加版本。
- Figma screenshot 使用 positional node index 投影 structural overlay；默认选择语义节点，Vector/Path 通过 drill-down；hover/selection 是 ephemeral，提交后的 surface/node/region target 才是研究事实。
- Node Annotation 锚定 captured evidence version；Refresh 无对应 node 时标记 stale 并提示设计师，不自动迁移或删除。
- Record + event 同 SQLite 事务；SQLite events canonical，JSONL 为可重建 derived export。
- Agent 只能通过语义 MCP tools 改变研究事实源；无 raw exec，无单独 geometry tool。
- 无 AgentAdapter / `/api/tasks` / fake Agent connection / mock product families 产品路径；测试仅用 deterministic MCP client / test doubles。
- Source artifact 由 Agent host 原生文件编辑写入；只有声明并校验通过后才进入事件、derived artifact 和 export。
- 研究 export：**入选**要求完整成功递归；**内容**为该项目整条成功语义链路（含闭环前成功阶段）。失败请求、失败标注、草稿、取消、Open Gap、canvas layout 不进入研究事实导出。
- 每个 issue 都必须包含真实 Agent 验证点和 open gaps 记录；真实 smoke 与 automated/mock 明确区分。

## Design Intent Alignment 六部分

新的 seed alignment gate 结合 `workflow/self-improve-design/align-design-intent/SKILL.md`，但 MVP 必答门只保留六部分：

1. Design principle
2. Visual language
3. Token
4. Layout
5. Component
6. Interaction

Content style observations 不作为 Ikran MVP 的必答 Design Intent Alignment 阶段。Agent 可以在 evidence notes 中记录明显 content 事实，但不能因为 content 问答未完成阻塞 seed extraction。

Alignment preparation 强制逐部分使用两类 attempt- and section-bound 卡片：六部分各自先生成至少一张表达该部分 Agent 已确认观察或合理假设的灰色 Agent Annotation，再生成该部分 2–5 张彩色 Question card；缺少任一类都不能进入 answering。Question card 允许 Agent `proposed_answer`，但它只预填编辑器且不计入 coverage；设计师必须逐卡点击发送，未修改预填记录为 Agent 提议/设计师接受，编辑后记录为 designer edited；只有非空 final answer 可使卡片和环节完成。

## UI / 设计原则

- **以 Figma 设计稿为 UI 实现依据。** 有 Figma 时按参考实现；无 Figma 时先问设计师。
- `Design issue/`（含 D01-D10）仅供与设计师沟通，不作为实现要求。
- `Issues 02/` 描述能力、API 边界、验证与风险；具体 UI 仍以 Figma 为准。
