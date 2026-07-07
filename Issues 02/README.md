# Ikran MVP Issues 02

来源：`IKRAN-MVP-PRD.zh-CN.md`，并对照旧 `issues/` 重排。PRD 是唯一产品标准；issue 执行不需要读取其他设计记录。

这些 issue 是新的 tracer-bullet vertical slices，覆盖从当前项目状态迁移到新的 Agent host + MCP + Workbench URL + tldraw 产品形态。每个阶段都有真实 Agent 接入点，不把真实验证集中到项目末尾。

## 依赖顺序

1. `01-runtime-workbench-url-session-shell.md` - Runtime Workbench URL 与 Session Shell
2. `02-project-session-binding-ikran-metadata.md` - Project Session Binding 与 `.ikran` 迁移
3. `03-semantic-mcp-tool-boundary-mock-client.md` - Semantic MCP Tool Boundary 与 Mock Client
4. `04-tldraw-workbench-shell-seed-entry.md` - tldraw Workbench Shell 替换 React Flow Seed Entry
5. `05-agent-host-figma-evidence-declaration.md` - Agent-Host Figma Evidence Declaration
6. `06-evidence-surface-region-annotation-slice.md` - Evidence Surface 与 Region Annotation Vertical Slice
7. `07-design-intent-alignment-six-part-gate.md` - 六部分 Design Intent Alignment Gate
8. `08-source-artifact-declaration-validation.md` - Source Artifact Declaration 与三类校验
9. `09-draft-design-system-derived-view.md` - Draft Design System 与 Derived View JSON
10. `10-seed-prototype-preview-record-preview.md` - Seed Prototype Preview 与 `record_preview`
11. `11-prototype-region-context-dom-inspection.md` - Prototype Region Context 与 DOM Inspection
12. `12-rule-update-proposal-confirm-cancel.md` - Rule Update Proposal Confirm/Cancel
13. `13-human-intent-new-prototype-loop.md` - Human-Intent New Prototype Loop
14. `14-optional-visual-reference-new-prototype.md` - Optional Visual Reference New Prototype Path
15. `15-research-event-export-undeclared-artifact-guard.md` - Research Event Export 与 Undeclared Artifact Guard
16. `16-staged-full-workflow-smoke-harness.md` - Staged Full Workflow Smoke Harness

## 全局约束

- Ikran Runtime 是一进程两 surface：stdio MCP + HTTP Workbench。
- Workbench URL 可在任意浏览器打开，理想环境是 Agent host 的嵌入式浏览器。
- Runtime 只绑定 localhost，Workbench URL 使用启动级 session token。
- Ikran Runtime 零 Figma 接触；Figma ingestion 在 Agent host 的 Figma MCP 中发生。
- tldraw shape 只是 canvas record 投影；Runtime semantic records 是事实源。
- Agent 只能通过语义 MCP tools 改变研究事实源；无 raw exec，无单独 geometry tool。
- Source artifact 由 Agent host 原生文件编辑写入；只有声明并校验通过后才进入事件、derived artifact 和 export。
- 每个 issue 都必须包含真实 Agent 验证点和 open gaps 记录。

## Design Intent Alignment 六部分

新的 seed alignment gate 结合 `workflow/self-improve-design/align-design-intent/SKILL.md`，但 MVP 必答门只保留六部分：

1. Design principle
2. Visual language
3. Token
4. Layout
5. Component
6. Interaction

Content style observations 不作为 Ikran MVP 的必答 Design Intent Alignment 阶段。Agent 可以在 evidence notes 中记录明显 content 事实，但不能因为 content 问答未完成阻塞 seed extraction。

## UI / 设计原则

- **以 Figma 设计稿为 UI 实现依据。** 有 Figma 时按参考实现；无 Figma 时先问设计师。
- `Design issue/`（含 D01-D10）仅供与设计师沟通，不作为实现要求。
- `Issues 02/` 描述能力、API 边界、验证与风险；具体 UI 仍以 Figma 为准。
