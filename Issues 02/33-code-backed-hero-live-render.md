# 33 — code-backed hero 活渲染(09C-D03 后续 slice)

Status: ready-for-agent

09C-D03 Slice 1(commit `c2090ff`)明确推迟的「code-backed hero 活渲染、
states hover 真切换」由本 issue 承接。issue 32 已提供 code-backed 的
静态形态(代码渲染截图)与回退档;本 issue 把组件详情 hero 升级为
**真实代码活渲染**,states hover 从只读/换图升级为切换真实状态。

09C-D03 记录的 open gap 是本 issue 的前置:「Code-backed adapter 的安全
装载边界和可支持的组件运行环境需在实现前结合现有 Workbench runtime 做
技术验证」。

## 锁定决策

1. **前置 spike 先行**:Code-backed adapter 的安全装载边界(沙箱/
   iframe 隔离、可支持的组件运行环境、依赖范围)结合现有 Workbench
   runtime 做技术验证,结论(可行边界与装载方案,或不可行原因)记录
   在本 issue Comments 后才进入实现。
2. **活渲染 hero**:code-backed 档从 32 的代码渲染截图升级为活组件;
   states hover 切换真实状态(取代 capture 换图/只读名称行)。
3. **失败显式回退**:装载失败按 32 → source-capture → unavailable 的
   档位链回退并标明原因;空白是事故,unavailable 是结论(沿用 D03
   原则)。
4. 活渲染只读呈现,不提供组件内交互能力(preview controls 明确不做)。

## 验收

- spike 结论记录在 Comments:装载边界、运行环境清单、安全模型。
- 组件详情 hero 为活渲染组件,hover 切换真实 state;无 code-backed
  条件的组件行为与 32 之后完全一致。
- 装载/渲染失败显式回退到静态档并标明原因,无空白 hero。
- `npx tsc --noEmit` 干净;全量 vitest 绿;相关 playwright spec 通过。

## Real Agent validation

- 真实项目内至少一个组件(Sticky Navigation 级,含真实 states)完成
  活渲染 + hover 真切换,设计师在真实 Browser 中确认(真实 smoke,
  与 automated 测试分开记录)。

## Open gaps

- 多组件/跨 surface 同时活渲染的性能边界。
- preview controls、anatomy overlay(D03 同批后续项)是否另立 issue,
  待本 issue 落地后重估。
- 活渲染组件对项目依赖版本(React 版本、样式体系)的兼容矩阵。

## 明确不做

- preview controls、anatomy overlay。
- 组件内交互/事件响应(纯呈现)。
- code-backed 档之外的呈现形态变更。

## Blocked by

- 32(code-backed capture 通道与静态回退档)。
