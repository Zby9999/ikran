# Ikran MVP Issues

来源：`IKRAN-MVP-PRD.zh-CN.md`

这些 issue 将 Ikran MVP PRD 拆成一组 tracer-bullet vertical slices。每个 issue 都尽量是一条窄但完整的端到端路径，完成后应该可以独立演示或验证。目标是一个月内可用于研究的原型，而不是生产级平台。

## 依赖顺序

1. `01-ikran-local-workbench-runtime-health.md` - Ikran local workbench 启动与 runtime health
2. `02-project-folder-ikran-metadata.md` - 项目文件夹选择与 `.ikran` 元数据
3. `03-mocked-agent-task-runner.md` - Mocked AgentAdapter 任务闭环
4. `04-seed-evidence-canvas-annotations.md` - seed evidence React Flow surface 与锚定标注
5. `05-seed-alignment-question-gate.md` - 五阶段 seed alignment 问题门
6. `06-draft-design-system-artifacts.md` - draft design-system 文件与 view JSON
7. `07-seed-prototype-live-preview.md` - seed prototype scaffold 与实时预览
8. `08-design-system-browser.md` - 基于 `design-system-view.json` 的设计系统浏览器
9. `09-contextual-rule-update-proposals.md` - 上下文 rule-update proposal 流程
10. `10-human-intent-new-prototype.md` - human-intent 新原型创建
11. `11-visual-reference-new-prototype.md` - 可选 visual-reference 新原型创建
12. `12-research-event-export.md` - 语义事件日志与研究导出包
13. `13-agent-output-validation-repair.md` - Agent 输出校验与一次修复
14. `14-headless-cli-agent-adapter.md` - Headless CLI AgentAdapter smoke path
15. `15-mocked-full-workflow-test.md` - 完整 mocked workflow 集成测试
16. `16-real-figma-agent-smoke-checks.md` - 真实 Figma 与真实 Agent smoke checks

## 说明

- 这些 issue 刻意避免拆成“纯前端 / 纯后端 / 纯测试”的横向任务。
- 每个 slice 都应保持 PRD 中的边界：Browser UI 只通过同源 API 和 Ikran Runtime 通信。
- Figma MCP 不进入 Ikran Runtime；真实 Figma ingestion 属于外部 Agent 环境。
- React Flow 是研究工作流画布基础；Region Annotation 是独立 workflow record，由 Evidence Surface overlay 渲染。
- source-of-truth design-system 文件始终保存在用户选择的本地项目文件夹中。

## 执行节奏

1. 第 1 阶段：项目基础
   - npm/npx 启动路径。
   - 本地 Ikran Runtime shell。
   - 由 Runtime 托管的 Next.js 浏览器 UI shell。
   - 同源 HTTP + SSE 通信。
   - localhost session token。
   - 项目文件夹选择流程。
   - `.ikran/` 元数据创建。
   - SQLite/事件日志基础。
   - mocked AgentAdapter。
   - 基础任务/结果 schema。

2. 第 2 阶段：种子提取工作台
   - React Flow 研究工作流画布 shell。
   - Figma Evidence Surface。
   - Region Annotation overlay。
   - 顶部五个阶段标签页。
   - 左侧问题列表。
   - 右侧回答面板。
   - Figma region anchor 模型。
   - mocked Figma evidence package。
   - 生成对齐问题，每个阶段二到五张卡。
   - 回答完成门禁。

3. 第 3 阶段：设计系统和预览循环
   - Agent 驱动的空文件夹项目初始化。
   - Next.js/TypeScript/Tailwind/npm 原型 scaffold。
   - workflow design-system/evidence 文件夹。
   - token.json 和设计系统源文件创建流程。
   - design-system-view.json 生成。
   - 带 Foundations 和 Components 的设计系统浏览器。
   - 来自本地开发服务器的实时 iframe 预览。
   - Prototype Evidence Surface。
   - Prototype region anchor 与非侵入式 DOM candidates。
   - 使用 mocked 或 real Agent 的种子重建流程。

4. 第 4 阶段：新原型和规则递归
   - 人类意图优先的新原型任务。
   - 可选视觉参考输入路径。
   - rule-update Agent 侧栏提案流程。
   - Confirm/Cancel 应用流程。
   - 导出包。
   - 真实 Agent smoke test。
   - 真实 Figma MCP smoke test。
   - 面向实验准备的加固 pass。

## UI / 设计原则

- **以 Figma 设计稿为 UI 实现依据。** 有 Figma 时按参考实现；**无 Figma 时先问设计师**，不要自主做设计更改。
- `Design issue/`（含 D01–D10）仅供与设计师沟通，**不是**实现要求或编码参考。
- `issues/` 描述能力与 API 边界；**具体界面以 Figma 为准**，issue 文中的 UI 描述不构成实现要求。
