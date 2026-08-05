# 24 — 组件 spec 字段注册表收敛

Status: ready-for-agent

09C-D03 后续。真实抽取（ikran test 7）暴露了组件 spec 字段注册表的系统性
问题：多个字段语义重复、写了不渲染、真实内容写进未注册字段被静默丢弃。
本 issue 一次性收敛：每个被写入的字段有明确渲染位置，每个渲染位置有唯一
数据来源。

## 问题清单（真实数据证据）

1. **`states` vs `stateMatrix` 完全重复**。`stateMatrix`（09A 结构化
   `{state, behavior}`）与 `states`（09B 散文数组）语义相同，Agent 把同一
   知识写两遍（甚至英文/中文各一份）。finalize 门禁
   （`component_spec_fields_missing`）强制所有富字段出现，重复是被结构
   逼出来的。
2. **`openQuestions` 未注册字段黑洞**。三个真实 spec 都把 6~7 条真实开放
   问题写进未注册的 `value.openQuestions`，UI 不渲染；注册字段 `openGaps`
   只有占位句。同类字段还有 `labelArrowGap` / `actionRadius` /
   `topBarHeight`。
3. **`verificationTargets` 写了不渲染**。在 `RICH_COMPONENT_SPEC_FIELDS`
   （门禁强制写），但 `RICH_GROUP_DEFS` 漏注册（永不显示）。真实内容如
   「默认态不得使用填充背景或胶囊形」恰是后续 code-backed 验证的关键输入。
4. **`meaning` vs `description` 分工未定义**。envelope 层 `meaning`（09 为
   token/规则设计）与 value 层 `description`（组件 spec 必填）对组件都指向
   "这是什么、为什么"，Agent 写近义重复内容；前端只渲染 `description`，
   spec 的 `meaning` 不可见（仅作 Purpose 兜底）。

## 锁定决策

1. **`states` 退役**：从 `RICH_COMPONENT_SPEC_FIELDS`、契约
   `component_spec_fields`、finalize 门禁、view-model `states-motion` 组
   移除。`stateMatrix` 为唯一状态真源，项保持 `{state, behavior}`；hero
   states 名称行只从 `stateMatrix` 派生（删掉 states 行优先分支）。
2. **`motion` 保留为独立富字段**：真实数据显示它可承载跨状态规则
   （project-strip：「浏览位置只响应指针拖拽、横向滚轮或触控横滑」），
   不折进 stateMatrix。UI 组改名 "Motion"（fields: `["motion"]`）。
3. **`verificationTargets` 补渲染**：加入 `RICH_GROUP_DEFS`。
4. **component-spec value key 闭集 + fail-closed**：schema 拒绝未知 key。
   闭集 = `description / props / boundaries / stateMatrix` +
   RICH（去掉 `states`）+ `group` + `sourceCaptures`。
   契约写明：开放问题只进 `openGaps`；参数类事实进 `props` / `sizes`；
   自定义 value key 会被拒绝（不是静默不渲染）。
5. **component-spec 停写 `meaning`**：schema 对 component-spec 把 meaning
   降级为可选；组件散文 = `value.description`。`meaning` 自此收窄为
   rules 专属（规则标题，issue 19 的编辑链路不受影响）。
   **例外**：component-list inventory 条目的 `meaning` 本次保留（Purpose
   兜底在用，清单行摘要是 candidate 时代的合理形态），不在本次动。
6. **不做旧数据兼容**：原型阶段，数据重抽。闭集校验落地后，ikran test 7
   现有 spec（含 `states` / `openQuestions`）将不可重新声明——接受，
   重新抽取产出新格式。

## 改动范围

- `lib/runtime/design-system-schema.ts`：`RICH_COMPONENT_SPEC_FIELDS` 去
  `states`；`validateComponentSpec` 加闭集校验 + meaning 可选化（`checkEntry`
  需为 component-spec 开口子）。
- `lib/runtime/initial-design-system-preparation.ts`：契约补 openGaps 归属、
  闭集说明、meaning 停写说明；确认 `component_spec_fields` 与 finalize 门禁
  随 RICH 自动正确。
- `components/workbench/design-system-view-model.ts`：group id
  `states-motion` → `motion`；`RICH_GROUP_DEFS` 调整 + 新增 Verification
  targets；`stateNames` 只从 stateMatrix 派生。
- `components/workbench/design-system-browser.tsx`：核对组渲染与硬编码引用
  （stateMatrix 动态列已支持额外 key，预计无改）。
- 测试：view-model 单测（states-motion 断言）、preparation 单测（contract +
  门禁 fixture）、schema/ingest 单测 fixture、e2e
  `design-system-browser.spec.ts` / `design-system-reader.spec.ts` 与
  `tests/fixtures/` 相关 fixture 全部改写为新格式。

## 验收

- 含 `states` / `openQuestions` 等未知 key 的 component-spec 声明被
  fail-closed 拒绝，错误详情指明未知 key。
- 新格式 spec（无 states、无 meaning、含 verificationTargets）声明 →
  ingest → Browser：State matrix 唯一状态区、Motion 组、Verification
  targets 组正常渲染。
- `npx tsc --noEmit` 干净；全量 vitest 绿；相关 playwright spec 通过。

## 明确不做

- token 区 `meaning` 退役与 per-domain 语义字段（`usedFor` 等）→ issue 25。
- rules（global / domain / layout / interaction）的 `meaning` 保持现状。
- code-backed hero、states hover 真切换等多 capture 交互（D03 后续 slice）。

## Comments

- 2026-08-04：方案经设计师讨论锁定。决策 1/3/4 源于 ikran test 7 真实抽取
  数据核对；决策 5 的更大背景（meaning 全系统语义漂移，含 09C-A 记录的
  typography 投影 label/usage 重复 bug）在 issue 25 展开。
  实施 handoff：`/tmp/ikran-24-component-spec-convergence-handoff.md`
  （临时文件，正式内容以本 issue 为准）。
- 2026-08-05：由 Codex 实施完成（commit `bc06427`）。复核结论：六个决策
  全部落地——`states` 退役、`motion` 独立成组、`verificationTargets` 补渲
  染、`COMPONENT_SPEC_VALUE_FIELDS` 闭集 fail-closed（`unknown_field`）、
  component-spec meaning 可选化（`meaningPolicy: "optional"`）、契约
  `component_spec_writing_policy` 写明 openGaps 归属与参数事实归口。
  验收：tsc 干净；vitest 93 文件 926 测试全绿（新增闭集拒绝测试）；
  playwright `design-system-browser` / `design-system-reader` 通过
  （附带修复侧栏组头状态汇总移除后遗留的陈旧断言一处）。
  工作区另有一笔未提交的侧栏简化（组头状态汇总移除，含 CSS / view-model /
  tsx / 单测），与后续 UI 方向一致，e2e 已同步。
