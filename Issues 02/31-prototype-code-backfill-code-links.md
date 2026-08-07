# 31 — Prototype 代码回写设计系统:codeLinks backfill 与 Formalize 软提示

Status: ready-for-agent

真实测试发现:设计系统正式化完成后,组件库 hero 仍是抽取时代的截图占位,
Prototype 阶段已产生的真代码组件没有回写。根因是结构性的——
`formalize_design_system` 只翻转条目 status,不触碰 spec value;
`codeLinks` 字段全仓库没有写入点(只有 Agent 手写 spec 与测试夹具);
Agent 引导链(confirm_prototype → formalize)对 code-backed 只字未提。
本 issue 建立 Prototype → Design System 方向的代码回写通道,并在
Formalize 上加**软提示**门禁,让缺口始终可见。

定位说明(沿用 09C-D03 两档决策):code-backed 是**呈现/溯源升级**,
不是 Formalize 的硬门禁——缺 codeLinks 不阻塞正式化。本 issue 只解决
「能力存在但无人引导、无回写通道」;视觉替换见 issue 32。

## 锁定决策

1. **新增独立 MCP 工具**(建议名 `backfill_component_code_links`,以
   实现契约为准):Agent 显式声明 entryId ↔ 代码路径/artifact 映射数组。
   Runtime 校验:entry 存在;每个代码路径对应的文件在 Agent 工作区真实
   存在且已由 source artifact 声明通道登记。校验通过才把 `codeLinks`
   写回源 spec JSON。
2. **写回复用 formalize 的既有模式**:schema 校验 + canonical 序列化 +
   content digest + 失败整体 restore;record + event 同事务,写
   backfill 事件(含 entry ids 与 code links)。
3. **软提示,不硬门禁**:`formalize_design_system` 返回结果新增提示
   字段,列出本次 formalized 条目中 `codeLinks` 为空、仍仅有
   `sourceCaptures` 的条目。只提示,不新增任何拒绝路径。
4. **引导链更新**:`confirm_prototype` 的 tool description 改为
   review modifications → backfill code links → formalize_design_system;
   MCP instructions 同步一句,守住 resident 预算测试
   (`tests/unit/mcp-instructions.test.ts` 的 ≤2KB)。
5. **映射由 Agent 显式声明**,Runtime 不按组件名/文件名自动匹配
   (避免匹配歧义污染事实源)。

## 改动范围

- `lib/mcp/` + `lib/runtime/commands/`:新工具注册、input schema、
  command 转发与 zod 校验。
- `lib/runtime/project-phase.ts`(或新模块):backfill 写回逻辑,复用
  `designSystemEntryContentDigest` 与 canonical 写盘;`formalizeDesignSystem`
  返回值增加 code-backfill 提示。
- `lib/mcp/shared.ts`:instructions 增加一句 backfill 引导;
  `lib/mcp/project-phase-tools.ts`:confirm_prototype / formalize 的
  tool description 更新。
- 测试:backfill 单测(成功写回、entry 不存在、路径未声明或文件不存在
  的 fail-closed、写盘失败 restore)、formalize 软提示单测、
  mcp-instructions 预算测试。

## 验收

- Agent 通过新工具声明映射后,spec JSON 的 `codeLinks` 持久化,
  ingest/view 层可见,Design System Browser 的 "Code links" 组正常渲染。
- 未声明 artifact 或不存在的路径被 fail-closed 拒绝,错误详情指明原因。
- `formalize_design_system` 在有/无 codeLinks 混合 promote 下照常成功,
  返回中正确列出缺口条目;不新增任何拒绝路径。
- `npx tsc --noEmit` 干净;全量 vitest 绿。

## Real Agent validation

- 真实 Agent 在 ikran test 7 类项目上走
  confirm_prototype → backfill → formalize 完整链路,确认引导文案足以
  让 Agent 在无人工提示下主动完成 codeLinks 回写(真实 smoke,与
  automated/mock 测试分开记录)。

## Open gaps

- code-backed 视觉替换(capture origin + 代码渲染截图)→ issue 32。
- 活渲染 hero → issue 33。
- 已 formalized 条目的 codeLinks 后续变更(代码重构移动文件)如何
  标 stale,随 issue 32 的 digest 机制一并定。

## 明确不做

- code-backed capture / hero 视觉变化(issue 32)。
- 缺 codeLinks 拒绝 formalize 的硬门禁。
- Runtime 侧的文件名/组件名自动匹配。

## Blocked by

- None — 可立即开始。
