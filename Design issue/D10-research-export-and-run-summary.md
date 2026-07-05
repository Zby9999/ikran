# D10 Research Export And Run Summary

## 对应实现 Issue

- `12` - 语义事件日志与研究导出包
- `15` - 完整 Mocked Workflow 集成测试
- `16` - 真实 Figma 与真实 Agent Smoke Checks

## 设计顺序

第 10 个设计。  
这是最后设计的页面，因为它依赖前面所有工作流产生的数据：questions、answers、evidence surfaces、region annotations、prototype runs、rule-update proposals、events 和 artifacts。

## 页面目标

让研究者或设计师导出一个可复现实验包，并查看当前 MAP case 的简要摘要。

这个页面不需要做 analytics dashboard。它只需要确认：

- 哪些研究数据会被导出。
- 导出是否成功。
- 哪些 artifact 已经包含在 project folder 中。
- 是否存在 real integration open gaps。

## 页面结构

- 顶部摘要：
  - project name/path。
  - seed extraction complete / incomplete。
  - prototype runs count。
  - region annotations count。
  - rule-update proposals count。
  - export status。

- 中心 export panel：
  - export package contents。
  - Generate export action。
  - latest export location。

- artifact index preview：
  - `events.jsonl`
  - `project-summary.json`
  - `alignment-questions.json`
  - `designer-answers.json`
  - `prototype-runs.json`
  - `rule-update-proposals.json`
  - `artifacts-index.json`
  - region annotation / evidence surface artifacts 摘要。

- integration readiness section：
  - mocked workflow verified。
  - real Figma smoke status。
  - real Agent smoke status。
  - open gaps。

## 关键状态

- Export not generated。
- Export generating。
- Export generated。
- Export failed。
- Mocked workflow complete。
- Real integration smoke incomplete。
- Open gaps present。

## 设计注意

- 不要做完整数据分析 dashboard。
- export 内容要可理解，但不需要展示 JSON 全文。
- open gaps 要诚实展示，尤其是真实 Figma/Agent smoke check 的限制。
- 这个页面偏研究收尾，不应抢占主工作流入口。

## 需要交付的设计稿

- export not generated 状态。
- export generated 状态。
- export failed 状态。
- artifact index preview。
- integration readiness with open gaps 状态。
