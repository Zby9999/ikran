# Runtime Workbench URL 与 Session Shell

## What to build

把现有本地 Runtime health path 迁移到 PRD 定义的入口形态：Agent 可以请求打开 Ikran，Runtime 启动或复用 HTTP Workbench surface，绑定 `127.0.0.1` 自动端口，生成启动级 session token，并返回可复制打开的 Workbench URL。Workbench 能展示最小 shell、health 状态和 SSE heartbeat。

这个 slice 要证明新的产品入口成立：用户不再通过独立 `npx ikran` 产品路径进入，而是让 Agent 返回 Workbench URL。URL 可在任意浏览器打开，理想路径是 Agent host 嵌入式浏览器。

## User stories covered

- 1, 2, 3, 4, 51, 52

## Acceptance criteria

- [x] Runtime 可以生成 `http://127.0.0.1:{port}/?session={token}` 形式的 Workbench URL。
  - `lib/runtime/runtime-endpoint.mjs` 的 `composeWorkbenchUrl` + `openWorkbench`；`bin/ikran.mjs` 打印、`bin/ikran-mcp.mjs` 的 `open_workbench` 返回。e2e (`tests/open-workbench-mcp.spec.ts`) 断言 URL 形式 `/http:\/\/127\.0\.0\.1:\d+\/\?session=[a-f0-9]{32,}$/`；launcher 冒烟实测打印。
- [x] Workbench URL 使用启动级 session token；缺失、错误或过期 token 被拒绝。
  - 复用现有 `lib/runtime/session.ts` 的 `authorize()`（localhost Host + 同源 Origin + 有效 session，fail-closed 403）；新增 `IKRAN_SESSION_TOKEN` env 覆盖让 coordinator 拼出 URL（token 仍只在内存）。e2e 断言 no/bad/cross-origin/nonlocal token → 403。
- [x] Workbench shell 能在浏览器打开并显示 Runtime health。
  - 复用现有 Figma-owned `ProjectSetupCard`（未改 UI）。e2e 导航 Workbench URL → 断言 shell 渲染 + `Local runtime connected` + service `ikran-runtime`。
- [x] Workbench shell 能建立 SSE heartbeat。
  - 复用现有 `/api/events` SSE。e2e 断言连接态（UI 刻意不展示 heartbeat 文本）。
- [x] Runtime 只绑定 localhost，不开放宽泛 CORS。
  - 复用 `lib/runtime/config.ts` + `authorize()`（无 CORS 头）；launcher/MCP 拒绝非 localhost host。
- [x] 现有 health/session 测试迁移到 Workbench URL 语义。
  - `tests/ikran-runtime-health.spec.ts` 重写：构建并导航 `http://127.0.0.1:{port}/?session={token}`，断言 shell+health+SSE，保留 API 安全矩阵。
- [x] 旧的“独立 app 自动开浏览器”不作为此 slice 的产品入口。
  - `bin/ikran.mjs` 头注释 + 输出把 Workbench URL 框为产品入口；auto-open 仅作 dev 便利保留。

## Real Agent validation

- [x] 在 Cursor 中让 Agent “打开 Ikran”，Agent 能返回 Workbench URL 或说明当前缺少 MCP tool。
  - 用户实测：Cursor 调 `open_workbench` 返回 `http://127.0.0.1:<port>/?session=<token>`，嵌入式浏览器成功打开 shell。出现的 hydration 警告是 **Cursor 3 Design Mode 注入 `data-cursor-ref`** 导致（非 Ikran 代码、dev-only），用 `--prod` 跑 workbench 即消除（生产 React 不输出该警告）。详见 `docs/manual-agent-smoke-issue01.md` 的 Known 小节。
- [ ] 在 Codex Desktop 中尝试同样路径；若 MCP tool 不暴露，记录 bug/open gap 和 fallback。
  - **待用户手动测。** 预期 fallback：若 Codex 不暴露 MCP tool（已知 gap `openai/codex#21019`/`#26659`/`#26072`），用 `npm start` / `node bin/ikran.mjs --prod --no-open` 打印的 URL 直接开（issue 允许“返回 URL **或**说明缺少 tool”）。
- [x] 将 Workbench URL 复制到系统浏览器，确认 session 仍可用。
  - e2e 覆盖（Playwright Chromium `page.goto(url)` → shell+health+SSE + no-token 403）；manual-smoke 文档第 4/5 节给出系统浏览器 + 坏 token `curl` 步骤供你确认。

## Likely difficulties for Agent

- Agent host 可能暂时不能发现本地 MCP tool，尤其是 Codex Desktop。
- Workbench URL 内含 token，Agent 可能把它当公开链接转述得过于随意。
- 当前代码已有 Next.js 同源 session 机制，但还不是 MCP `open_workbench` 语义。

## Suggested ways through

- 先用 mock MCP client 或 local tool harness 验证 `open_workbench` 返回值，再做 Cursor/Codex 手动 smoke。
- 明确 Workbench URL 是 localhost-only，不支持远程打开。
- 复用现有 `session`、health 和 SSE 代码，不先重写 Runtime 进程模型。

## Blocked by

None - can start immediately

---

## 完成报告（要点）

- **状态**：完成并通过验证。`npm run typecheck` 0 错；`npm run check` 全量 e2e **47/47 绿**；launcher/MCP/P2a 手测均符合预期。改动均**未 commit**。
- **架构选择**：本 slice 用 **两-process coordinator + env-token bridge**（ADR 0001 的 tracer bullet）——coordinator 进程（launcher 或 MCP server）生成启动 token、自动选端口、spawn Next HTTP 子进程、写 user-only 复用状态、返回 Workbench URL。**真·一进程两表面（custom Next server + MCP handlers 共享内存记录）是 deliberate follow-up，留给 Issue 02/03**（ADR “后续工作项 #2”），代码注释已标注。
- **实现文件**（issue 02/01）：
  - `lib/runtime/session.ts`（改：`IKRAN_SESSION_TOKEN` env 覆盖）
  - `lib/runtime/runtime-endpoint.mjs`（新：`openWorkbench` 复用-or-spawn、`composeWorkbenchUrl`、复用状态、`pickFreePort`、`probeRuntimeAlive`）
  - `bin/ikran.mjs`（重写：自动端口 + 打印 Workbench URL + 复用 + 退出清理）
  - `bin/ikran-mcp.mjs`（新：最小 MCP stdio server，仅 `open_workbench`；日志全走 stderr，子进程 stdout 排空）
  - `tests/ikran-runtime-health.spec.ts`（迁到 Workbench URL 语义）
  - `tests/open-workbench-mcp.spec.ts`（新：MCP e2e via SDK client + reuse + 403）
  - `docs/manual-agent-smoke-issue01.md`（新：你的手动 Agent 测试 setup + 指引）
  - `docs/issue02-01-handoff.md`（新：实现规格）
- **Review 修复（P1/P2a/P2b/P3，已全部完成）**：
  - P1 `@modelcontextprotocol/sdk` 加为直接生产依赖（不再靠 shadcn hoist）。
  - P2a `--port`/`IKRAN_PORT` 不再被旧 live endpoint 静默覆盖：冲突时明确报错、不返回旧 URL、不起孤儿 Runtime；无 `--port` 仍复用。
  - P2b figma oembed fetch 可注入（`IKRAN_FIGMA_OEMBED_MOCK`），e2e 默认离线跑，真 Figma probe 留给手动 smoke/单独网络测试。
  - P3 `composeWorkbenchUrl` 单测改用**真实实现**（`runtime-endpoint.d.mts` 提供类型 + 动态 `import()` 规避 CJS runner 对相对 `.mjs` 的 `require()` 失败）。
- **真实 Agent 验证**：Cursor 已通过（返回 URL + 打开 shell；hydration 警告已用 `--prod` 解决，非 Ikran bug）。**Codex Desktop 待你手动测**（fallback：用 launcher 打印的 URL 直接开）。
- **Open gaps（非阻塞）**：
  1. Next 16 同目录单 `next dev` 锁——手动 `npm run dev` 与 launcher/MCP 并存会冲突；推荐路径（`npm start`/launcher 启动、Agent 经 `open_workbench` 复用）天然避开。
  2. ADR 标记的 Runtime Figma validate/oEmbed 接触面 + 一进程两表面整合，留给后续 slice 退役/合并。