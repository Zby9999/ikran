# Ikran MVP Issues

来源：`MAP-MVP-PRD.md`（文档标题与产品名已更新为 Ikran）

这些 issue 将 Ikran MVP PRD 拆成一组 tracer-bullet vertical slices。每个 issue 都尽量是一条窄但完整的端到端路径，完成后应该可以独立演示或验证。目标是一个月内可用于研究的原型，而不是生产级平台。

## 依赖顺序

1. `01-ikran-local-workbench-runtime-health.md` - Ikran local workbench 启动与 runtime health
2. `02-project-folder-ikran-metadata.md` - 项目文件夹选择与 `.ikran` 元数据
3. `03-mocked-agent-task-runner.md` - Mocked AgentAdapter 任务闭环
4. `04-seed-evidence-canvas-annotations.md` - seed evidence 画布与锚定标注
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
- source-of-truth design-system 文件始终保存在用户选择的本地项目文件夹中。

## UI / 设计原则

- **以 Figma 设计稿为 UI 实现依据。** 有 Figma 时按参考实现；**无 Figma 时先问设计师**，不要自主做设计更改。
- `Design issue/`（含 D01–D10）仅供与设计师沟通，**不是**实现要求或编码参考。
- `issues/` 描述能力与 API 边界；**具体界面以 Figma 为准**，issue 文中的 UI 描述不构成实现要求。
