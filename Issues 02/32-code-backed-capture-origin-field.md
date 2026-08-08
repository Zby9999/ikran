# 32 — code-backed capture:origin 字段与代码渲染截图

Status: ready-for-agent

issue 31 建立 codeLinks 回写通道后,本 issue 让「截图占位换成代码组件」
在用户可感知的层面真正发生:capture 数据模型区分来源,Prototype 真组件
经渲染截图生成 code-backed capture 写回条目,Design System Browser 的
`DsVisualOrigin = "code-backed"` 自类型定义以来首次被真正赋值。

本 issue 是 09C-D03 两档决策下 code-backed 档的**静态形态**(代码渲染
截图),不是活渲染——活渲染是 issue 33。

## 锁定决策

1. **capture 模型新增 `origin: "source" | "code"`**:
   `DesignSystemLayoutCapture` 扩展,spec `sourceCaptures` 契约、schema
   校验、DB `source_captures_json` 存储与 ingest 剥离规则同步;旧数据
   无 `origin` 一律视为 `"source"`,向后兼容。
2. **code-backed capture 由 Agent 显式触发生成**(工具参数声明
   entryId):Runtime 基于 31 写入的 `codeLinks`,利用既有
   `record_preview` / dev server 能力渲染该组件并截图,以
   `origin: "code"` 写回条目的 captures。不做自动批量生成。
3. **hero 展示**:有条目级 code capture 时 hero origin =
   code-backed(全仓库首次赋值该档),origin 标记与
   SourceCaptureOriginPopover 区分「代码渲染」与「原设计截图」;
   无 code capture 时保持 source-capture / unavailable 现状不变。
4. **stale 语义**:code capture 记录来源代码文件的 content digest;
   文件变化后 capture 标 stale,沿用 D02 的 stale 展示语义
   (左下 caption),不自动重新生成。

## 改动范围

- `lib/runtime/design-system-schema.ts` / `design-system-ingest.ts` /
  `migrations.ts`:origin 字段校验、存储与剥离规则。
- `lib/runtime/design-system-view.ts`:capture view 模型携带 origin。
- 新工具或 `record_preview` 链路扩展:组件渲染 + 截图 + 写回 captures。
- `components/workbench/design-system-browser.tsx`:hero 按 origin 赋值
  code-backed;popover 文案区分来源。
- 测试:schema/ingest/view 单测、browser e2e fixture(code-backed 档
  渲染断言)。

## 验收

- 含 codeLinks 的组件经渲染截图后,Browser hero 显示 code-backed 档
  (不再是 source-capture 截图),popover 标明代码来源。
- 无 codeLinks 组件行为完全不变;无 origin 的旧 captures 正常显示为
  source-capture。
- 代码文件变更后对应 code capture 显示 stale caption。
- `npx tsc --noEmit` 干净;全量 vitest 绿;design-system-browser /
  design-system-reader e2e 通过。

## Real Agent validation

- 真实 Agent 在 ikran test 7 类项目上完成至少一个组件(Text Link 级)
  的 code-backed capture 生成与替换,设计师在真实 Browser 中确认 hero
  视觉与 origin 标记(真实 smoke,与 automated 测试分开记录)。

## Open gaps

- 组件渲染环境差异(props 缺省值、依赖外部数据)导致截图失败时的
  兜底形态——失败应诚实回退 source-capture,不留空白。
- 活渲染替代静态 code capture → issue 33。

## 明确不做

- 活渲染 hero、states hover 真切换(issue 33)。
- 自动批量为所有组件生成 code capture。
- Figma source capture 的重裁/更新机制(D02 既有语义不动)。

## Blocked by

- 31(codeLinks 回写通道与文件存在性校验)。

## Comments

### 2026-08-08 — 实现记录(commit `d5558a2`,已推送)

- capture 模型增 `origin: "source" | "code"`:schema 校验(absent 合法 = source;`"code"` 必带非空 `codeLinks` + `codeDigest`)、ingest 透传、view 解析默认 source;旧数据向后兼容有单测钉死。origin 存同一 `source_captures_json` 列,migrations 无需改。
- stale:code capture 写入时冻结 `codeCaptureDigest`(sha256 over 排序后的 `path:fileSha256` 行);view 每次读取重算,文件变化/缺失/越界 → D02 stale caption,不自动重生成;code capture 不套 Figma surface stale 判定(surfaceId 仅作 provenance)。
- 新工具 `capture_component_code_hero`:Agent 指名渲染该组件的 prototype surface(完整复用 `capture_rule_screenshot` 链路 + crop 两遍法),截图以 `origin: "code"` 写回并替换旧 code capture(source captures 不动);渲染失败发生在任何写入之前,零写入诚实回退;formalized 条目补 approval 溯源。偏离说明:渲染形态为「Agent 指名 surface + crop」而非框架无关单挂组件——组件 props/依赖不确定,正是 spec 的 open gap,活渲染/隔离 harness 属 33。
- Browser hero 优先 code capture,`DsVisualOrigin = "code-backed"` 首次赋值;popover 按 origin 分档("Code-backed render" / source,Code 链接行)。
- 验证:tsc 干净;全量 vitest 1106 绿;playwright design-system-browser/reader 通过(580 行既有布局断言 flaky 一次,单独重跑通过)。双轴 code review 修复:doc comment 归位、screenshot reason 联合收窄去 `as` cast、stale 态 browser 断言补齐。
- 遗留:**Real Agent validation 未做**(Text Link 级组件 + 设计师确认),setup 见 `docs/real-agent-validation-issues-31-33.md` Flow B。

### 2026-08-08 — 真实 Agent 验证后的取代决定

真实验证暴露了这条截图链的产品级问题:每个组件都要重新打开 Prototype
页面并截图,多组件/多轮迭代会重复启动页面、堆积无效 PNG,而且截图写入会把
Prototype Surface 标成 stale,最终让画布显示空白 frame。Issue 33 的修订实现
因此**完全取代** `capture_component_code_hero` 作为 Active MCP 路径:

- MCP catalog 不再暴露 `capture_component_code_hero`;旧 schema/domain 只保留为
  历史数据兼容,Agent 不再能走 code-render screenshot 流程。
- code-backed hero 改为 `declare_component_live_heroes` 的截图无关批量声明;
  Browser 不再把 `origin: "code"` 的旧 PNG 作为 hero 档。
- Figma/source capture 继续作为 live 失败时的诚实回退证据;不生成新的 code
  capture,也不因 component hero 构建反复打开 Prototype 页面。

本条原实现记录保留为决策历史;当前产品契约以 Issue 33 最新修订为准。
