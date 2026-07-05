# D05 Live Prototype Preview And Review

## 对应实现 Issue

- `07` - Seed Prototype Scaffold 与实时预览
- `10` - Human-Intent 新原型创建
- `11` - 可选 Visual-Reference 新原型创建
- `16` - 真实 Figma 与真实 Agent Smoke Checks

## 设计顺序

第 5 个设计。  
它跟在 draft design-system artifacts 之后，因为 prototype preview 是验证 design-system extraction 是否成立的第一条真实闭环。

## 页面目标

让设计师在 MAP 中看到 live prototype，并能进入 focus mode 直接体验交互。  
页面同时需要支持 seed reconstruction review 和后续 new prototype review。
prototype preview 在 React Flow 中表现为 Prototype Evidence Surface；局部反馈通过 surface overlay 选择区域，而不是截图历史。

## 页面结构

- 顶部状态：
  - Preview starting / running / failed。
  - 当前 prototype run 名称。
  - Focus mode action。

- 左侧流程区：
  - 当前 run 所属阶段：seed reconstruction / new prototype。
  - run history 简要列表。
  - linked design-system version。

- 中心 React Flow 工作区：
  - Prototype Evidence Surface。
  - iframe live preview。
  - Region Annotation overlay。
  - preview unavailable fallback。
  - loading skeleton。

- 右侧 Agent/sidebar：
  - 当前 run summary。
  - designer feedback input。
  - related questions / answers link。
  - 可能触发 rule update 的提示。

## 关键状态

- Dev server starting。
- Preview running。
- Preview failed。
- Focus mode available。
- Designer feedback submitted。
- Agent updating prototype。
- Prototype updated。

## 设计注意

- preview 是 live iframe，不是 screenshot history。
- focus mode 应该是明确动作，但不要破坏主工作区上下文。
- designer feedback 针对当前 prototype，不要自动等同于 design-system rule update。
- seed reconstruction 和 new prototype 可以复用同一 preview 框架，但标题与上下文要区别清楚。
- 局部 feedback 可以绑定到 prototype region；整体 feedback 只绑定到当前 prototype surface/run。

## 需要交付的设计稿

- preview loading 状态。
- preview running 状态。
- preview failed 状态。
- focus mode 入口状态。
- designer feedback panel 状态。
