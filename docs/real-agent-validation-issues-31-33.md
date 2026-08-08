# Issues 31/32/33 Real Agent Validation Setup — 2026-08-08

三张票(31 codeLinks backfill、32 screenshot 路径退休、33 live hero)的自动化
验证与后续修订以当前代码为准,剩余验收项是 Real Agent validation。本文档是
执行 setup:环境准备、
三条验证流程、通过标准与证据记录方式。真实 smoke 与 automated/mock 分开记录
(全局约束);结果格式沿用 `docs/manual-agent-smoke-issue07.md`(Result /
Automated / Real Agent 分节)。

相关契约原文:三张 issue 的「Real Agent validation」节与 2026-08-08 实现记录
comment;工具的权威行为以 tool description 为准
(`backfill_component_code_links`、`declare_component_live_heroes`、
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
   `backfill_component_code_links` 与 `declare_component_live_heroes`,且不含
   `capture_component_code_hero`;否则 reload catalog(issue07 smoke 的
   stale-catalog 教训)。
4. **Pre-flight 检查**(Workbench 或 sqlite 查项目 DB):
   - 项目相位:Flow A 的正式化链路需要 `design_system_formal`;
     backfill/live declaration 工具本身无相位门禁,可先做 B/C;
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

## Flow B — Issue 32:旧 screenshot 路径退休检查

1. MCP catalog 不含 `capture_component_code_hero`,避免 Agent 按组件重复打开
   页面和生成 code PNG。
2. 旧 `origin: "code"` capture 存在时 Browser 不把它选为 hero;有 source
   capture 显示 source,否则显示 unavailable。
3. 执行 Flow C 的 live 声明后,条目的 Active captures 只保留 source
   evidence;不产生 `design_system_code_capture_recorded` 事件。

通过标准:旧 screenshot 不再是 Active 产品路径,历史数据仍可读取而不崩溃。

## Flow C — Issue 33:live hero + states 真切换

1. Agent 在 prototype 应用中一次写完所有目标组件的 harness 路由(契约见
   下),逐个经 `record_artifact_written` 声明。
2. 所有 harness/code 声明完成后只调用一次 `record_preview`;不要逐组件刷新。
   每个页面必须显式传 `routePath`(`/` 为首页,例如
   `/projects/atlas` 为 Atlas),不得假设 Runtime 会从 `sourceArtifactPath`
   推导框架路由。
3. 一次批量调用 `declare_component_live_heroes`,每项传
   `entryId + surfaceId + harnessPath + harnessArtifactPath`。
4. 期望:hero 变 live iframe(sandboxed、原生 pointer events 开启);default 下
   直接 hover 组件即可看到真实 hover,且 iframe URL 不变;hover states 名称 →
   iframe 重导航 `?state=<name>`,用于强制展示状态;移出状态行恢复默认。
5. 回退(三值文案均带原因、无空白):surface not ready;surface stale
   (code_changed);harness 5s 超时 → 落 source capture,没有 source 时显示
   unavailable。readiness 恢复
   (starting→ready)自动重试 live。
6. 修改 harness/code 后 surface 按 Issue 30 正常 stale;Browser 保留最后一张
   Prototype screenshot,Agent 完成全部修改后再 `record_preview` 一次。
   非 live screenshot 与 live iframe 必须保持同一 1133px fixed presentation
   viewport;同时打开多个 Workbench tab 不得触发按各自窗口宽度反复重截、
   视觉缩放或左右边距变化。
7. 目标组件:**Sticky Navigation 级**(含真实 states);设计师确认。

Harness 契约(与 tool description 一致):

- 同源相对路径(`/` 开头,禁 `//`、`..`、`?`、`#`、反斜杠),由 Agent
  写作并经 `record_artifact_written` 声明;
- 独立挂载组件、默认 props、纯呈现;响应 `?state=<name>`(state 名单取自
  spec `stateMatrix`);不调 Runtime API。为让 Browser 完整包裹组件，harness
  在挂载时及 `ResizeObserver` 更新时单向上报 body 的 `scrollWidth` /
  `scrollHeight`：

```ts
const reportSize = () =>
  window.parent.postMessage(
    {
      type: "ikran:component-size",
      width: document.body.scrollWidth,
      height: document.body.scrollHeight
    },
    "*"
  );

const observer = new ResizeObserver(reportSize);
observer.observe(document.body);
reportSize();
```

  Browser 仅接受当前 iframe 且 origin 与 preview URL 一致的几何消息；不向
  harness 回传 Runtime 数据。尺寸上报是当前 harness 契约的必需部分，不保留
  旧 harness 的 Runtime 测量回退。
- harness 内局部隐藏框架开发 chrome,普通 Prototype 仍保留。Next.js 在
  harness route 添加 `nextjs-portal { display: none !important; }`,不得用
  `next.config` 的全局 `devIndicators: false`。

示例(Next.js App Router,组件需接受可选 state prop,或由 harness 把
state 名映射为 props/交互模拟):

```tsx
// app/__ikran/component/sticky-navigation/page.tsx
"use client";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { StickyNavigation } from "@/components/StickyNavigation";

export default function Harness() {
  const state = useSearchParams().get("state") ?? undefined;
  useEffect(() => {
    const reportSize = () =>
      window.parent.postMessage(
        {
          type: "ikran:component-size",
          width: document.body.scrollWidth,
          height: document.body.scrollHeight
        },
        "*"
      );
    const observer = new ResizeObserver(reportSize);
    observer.observe(document.body);
    reportSize();
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <style jsx global>{`nextjs-portal { display: none !important; }`}</style>
      <StickyNavigation state={state} />
    </>
  );
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
