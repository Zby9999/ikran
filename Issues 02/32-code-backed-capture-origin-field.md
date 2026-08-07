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
