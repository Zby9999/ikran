# Runtime Workbench URL 与 Session Shell

## What to build

把现有本地 Runtime health path 迁移到 PRD 定义的入口形态：Agent 可以请求打开 Ikran，Runtime 启动或复用 HTTP Workbench surface，绑定 `127.0.0.1` 自动端口，生成启动级 session token，并返回可复制打开的 Workbench URL。Workbench 能展示最小 shell、health 状态和 SSE heartbeat。

这个 slice 要证明新的产品入口成立：用户不再通过独立 `npx ikran` 产品路径进入，而是让 Agent 返回 Workbench URL。URL 可在任意浏览器打开，理想路径是 Agent host 嵌入式浏览器。

## User stories covered

- 1, 2, 3, 4, 51, 52

## Acceptance criteria

- [ ] Runtime 可以生成 `http://127.0.0.1:{port}/?session={token}` 形式的 Workbench URL。
- [ ] Workbench URL 使用启动级 session token；缺失、错误或过期 token 被拒绝。
- [ ] Workbench shell 能在浏览器打开并显示 Runtime health。
- [ ] Workbench shell 能建立 SSE heartbeat。
- [ ] Runtime 只绑定 localhost，不开放宽泛 CORS。
- [ ] 现有 health/session 测试迁移到 Workbench URL 语义。
- [ ] 旧的“独立 app 自动开浏览器”不作为此 slice 的产品入口。

## Real Agent validation

- [ ] 在 Cursor 中让 Agent “打开 Ikran”，Agent 能返回 Workbench URL 或说明当前缺少 MCP tool。
- [ ] 在 Codex Desktop 中尝试同样路径；若 MCP tool 不暴露，记录 bug/open gap 和 fallback。
- [ ] 将 Workbench URL 复制到系统浏览器，确认 session 仍可用。

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
