# Issues 31/32/33 Real Agent Validation Setup — 2026-08-08

三张票(31 codeLinks backfill、32 code-backed capture、33 live hero)的自动化
验证已全绿(tsc 干净;vitest 1131;playwright design-system-browser/reader 通过),
剩余验收项是各自的 Real Agent validation。本文档是执行 setup:环境准备、
三条验证流程、通过标准与证据记录方式。真实 smoke 与 automated/mock 分开记录
(全局约束);结果格式沿用 `docs/manual-agent-smoke-issue07.md`(Result /
Automated / Real Agent 分节)。

相关契约原文:三张 issue 的「Real Agent validation」节与 2026-08-08 实现记录
comment;工具的权威行为以 tool description 为准
(`backfill_component_code_links`、`capture_component_code_hero`、
`formalize_design_system` 的 `code_backfill_hints`)。

## 环境准备

1. **仓库**:latest main(≥ `c8eaff0`),`npm install` 就绪。
2. **测试项目**:推荐复用 `~/Desktop/ikran test 7`——已有真实 component
   spec(Text Link / Project Strip / Sticky Navigation,含 sourceCaptures)
   且 prototype 代码在其工作区。仅当其状态不可用(见 Pre-flight)时新建
   项目走完整 seed → extraction → prototype 流程。
3. **启动**:`npm start`(ikran launcher,起 Runtime 并开浏览器)或
   `npm run dev`(127.0.0.1:3000)。Runtime 按 cwd 自动绑定项目
   (tests/cwd-auto-bind.spec.ts);Agent host 加载 Ikran MCP catalog
   (`bin/ikran-runtime.mjs`)后,确认 catalog 含
   `backfill_component_code_links` 与 `capture_component_code_hero`——不含
   则 reload catalog(issue07 smoke 的 stale-catalog 教训)。
4. **Pre-flight 检查**(Workbench 或 sqlite 查项目 DB):
   - 项目相位:Flow A 的正式化链路需要 `design_system_formal`;
     backfill/capture 工具本身无相位门禁,可先做 B/C;
   - component-spec 条目的 status(candidate/formalized)、现有
     sourceCaptures、codeLinks 现状;
   - `source_artifacts` 中 code/prototype 类声明(31 的校验依赖;缺则 Agent
     先经 `record_artifact_written` 声明 prototype 代码文件);
   - prototype surface 记录与 preview 状态(32/33 依赖;preview 不在线时
     Agent 先 `record_preview`)。

## Flow A — Issue 31:backfill + formalize 软提示

1. 让真实 Agent 检查各 component spec 的 codeLinks 现状(应为空)。
2. Agent 调 `backfill_component_code_links`,显式声明 entryId ↔ 代码路径
   映射(如 Text Link → 其 prototype 组件 .tsx)。期望:源 spec JSON 写回
   codeLinks、DB 同步、`design_system_code_links_backfilled` 事件落库;
   Design System Browser 的 "Code links" 组渲染。
3. 反向用例(各自拒绝且零写入,错误指明原因):未声明的路径;artifactType
   为 design-system 类(如 layout-rules.json)的已声明路径;不存在的
   entryId;非 component-spec 条目。
4. 软提示:在可正式化的状态下 promote 混合条目(有/无 codeLinks),确认
   `formalize_design_system` 照常成功且返回 `code_backfill_hints` 正确列出
   缺口条目。
5. 引导验证(买点):不给额外提示,观察 Agent 在 `confirm_prototype` 后是否
   自主走 backfill——引导链文案是否足够,如实记录。

通过标准:issue 31 验收节 + Real Agent validation 节。

## Flow B — Issue 32:code-backed capture

1. Agent 对含 codeLinks 的组件(至少 Text Link 级一个)调
   `capture_component_code_hero`:surfaceId 指名渲染该组件的 prototype
   surface,crop 两遍法(先 plain  inspect,再 crop 框选组件)。
2. 期望:hero 变 code-backed 档(origin 标记 + popover "Code-backed
   render" + Code 链接行);旧 code capture 被替换,source captures 不动。
3. stale:改动一个 codeLinks 指向的代码文件 → Browser 显示 stale caption;
   重跑工具 → 恢复 fresh。
4. 诚实回退:preview 不可用或渲染失败 → 零写入,hero 保持
   source-capture,无空白。
5. 反向:无 codeLinks 条目 → `no_code_links` 拒绝。
6. **设计师在真实 Browser 确认 hero 视觉与 origin 标记**(验收必需)。

通过标准:issue 32 验收节 + Real Agent validation 节。

## Flow C — Issue 33:live hero + states 真切换

1. Agent 在 prototype 应用中添加 harness 路由(契约见下),经
   `record_artifact_written` 声明后,重跑 `capture_component_code_hero`
   并传 `harnessPath`。
2. 期望:hero 变 live iframe(sandboxed、只读、pointer-events:none);
   hover states 名称 → iframe 重导航 `?state=<name>`,组件切真实状态;
   移出恢复默认。
3. 回退(三值文案均带原因、无空白):surface not ready;surface stale
   (code_changed);harness 5s 超时 → 落 32 静态 capture。readiness 恢复
   (starting→ready)自动重试 live。
4. digest stale 不回退 live:改代码后 live 仍渲染当前代码,popover 标
   stale。
5. 目标组件:**Sticky Navigation 级**(含真实 states);设计师确认。

Harness 契约(与 tool description 一致):

- 同源相对路径(`/` 开头,禁 `//`、`..`、`?`、`#`、反斜杠),由 Agent
  写作并经 `record_artifact_written` 声明;
- 独立挂载组件、默认 props、纯呈现;响应 `?state=<name>`(state 名单取自
  spec `stateMatrix`);不 postMessage、不调 Runtime API。

示例(Next.js App Router,组件需接受可选 state prop,或由 harness 把
state 名映射为 props/交互模拟):

```tsx
// app/__ikran/component/sticky-navigation/page.tsx
"use client";
import { useSearchParams } from "next/navigation";
import { StickyNavigation } from "@/components/StickyNavigation";

export default function Harness() {
  const state = useSearchParams().get("state") ?? undefined;
  return <StickyNavigation state={state} />;
}
```

通过标准:issue 33 验收节 + Real Agent validation 节;本条覆盖 live-hero
端到端(实现时留了 playwright e2e 给本阶段)。

## 证据与记录

- 每条 Flow 记录:Agent host 与 MCP catalog 版本、关键工具调用与返回
  payload、`events` 表中的对应事件、Browser 截图(hero 各档、popover、
  stale caption、回退 caption、states 切换前后)。
- 结果写成 `docs/manual-agent-smoke-issues-31-33.md`(格式沿用 issue07
  smoke);三张 issue 的 Comments 各补一条验证记录后,Status 方可翻
  `resolved`。
- 不记录 session token、host 凭证、个人会话、fixture 数据库(issue07 惯例)。

## 清理

- 测试项目的 harness 路由与 backfill/capture 产物属项目工作区,不入本仓库
  git;`.scratch/` 探针(如 spike-33/probe.mjs)按惯例不入库。
- Runtime 关闭时 preview dev server 由 29a8d6b 的 shutdown sweep 清理;
  遗留 surface 行为(`runtime_shutdown` park → 重启 restore)属 issue 30
  既有语义,发现异常单独记录,不算本线失败。
