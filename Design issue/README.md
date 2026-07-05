# Ikran 关键页面设计 Issue 总览

来源：`IKRAN-MVP-PRD.zh-CN.md` 与 `issues/` 中的实现 issue。

这个文件夹列出设计师需要优先提供的关键页面设计。这里的“页面”不是代码路由，而是需要在 Figma 中明确视觉结构、信息层级和交互状态的主要工作区。

## 推荐设计顺序

1. `D01-project-start-and-bridge-status.md`  
   先确定 MAP 的整体外壳、项目绑定、Bridge/Agent 状态，因为后续所有页面都复用这个布局和状态表达。

2. `D02-seed-evidence-canvas.md`  
   再设计 seed evidence 的 React Flow 视觉工作区，因为这是 MAP 与普通 chat workflow 最大的差异：agent 的理解状态必须落在 Evidence Surface 上。

3. `D03-seed-alignment-question-workspace.md`  
   在 evidence surface 基础上设计 question answering，因为问题卡、Region Annotation anchor、右侧回答区共同定义核心 alignment 体验。

4. `D04-seed-extraction-progress-and-artifacts.md`  
   设计 all-answered 之后的生成与结果状态，确保用户知道系统正在把回答转成 design-system artifacts。

5. `D05-live-prototype-preview-and-review.md`  
   然后设计 prototype preview，因为 seed reconstruction 是验证 design system 是否成立的第一条闭环。

6. `D06-design-system-browser-foundations.md`  
   seed 完成后进入 Design System browser，先画 Foundations 信息结构。

7. `D07-design-system-browser-components.md`  
   再画 Components inventory/detail，因为它依赖 Foundations 的浏览框架，但信息密度更高。

8. `D08-contextual-rule-update-proposal.md`  
   在 Design System browser 结构稳定后，设计 contextual Agent editing 和 update proposal。

9. `D09-new-prototype-creation.md`  
   最后设计 post-startup 的主循环：从 human intent 或 optional visual reference 创建新 prototype。

10. `D10-research-export-and-run-summary.md`  
    最后补齐研究导出和实验记录页面，它依赖前面事件、prototype run、rule update 的信息模型。

## 为什么按这个顺序

- 先画 shell，再画具体工作区：MAP 的核心体验依赖固定的左侧流程、中心画布/预览、右侧 Agent panel。
- 先 seed，再 browser，再 recursion：这与 PRD 的生命周期一致，先完成一次 design-system startup，再进入新 prototype 与 rule recursion。
- 先高频操作，再低频导出：alignment、preview、browser 是设计师每天会用的页面；export 和 smoke check 更偏研究收尾。
- 先 designer-facing，再 technical-facing：Bridge、AgentAdapter、validation repair 等技术状态只应以轻量状态或错误恢复出现，不应压过设计工作流。

## 与实现 Issue 的关系

每个设计文档顶部都列出对应实现 issue 编号。这里使用本地 issue 文件编号，例如 `01` 对应 `issues/01-map-shell-bridge-heartbeat.md`。
