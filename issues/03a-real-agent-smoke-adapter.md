# Evidence Surface 前的真实 AgentAdapter Smoke

## What to build

在 seed Evidence Surface 工作开始前，加入一条很窄的真实 AgentAdapter smoke path。Ikran Runtime 应能启动一个已配置的真实外部 Agent CLI，传入一个小的结构化 smoke task，收集结构化 JSON 输出，完成 schema 校验，持久化 task state，并通过 mocked adapter 已经验证过的同一条 task/SSE 路径把生命周期更新流回 Browser UI。

这是技术 readiness slice，不是产品工作流。它的目的，是在 Issue 04 引入 React Flow、Evidence Surface 和 Region Annotation 的复杂度之前，证明现有 AgentAdapter 边界不是只为 mock demo 服务。

这个 slice 不替代后续 hardened headless CLI adapter 工作。它只是把一次最小真实 Agent smoke check 前移，避免在尚未验证真实 Agent 边界可用的前提下继续搭建 workbench。

smoke task 应刻意保持很小：

```ts
type RealAgentSmokeResult = {
  message: string;
  checklist: Array<{ label: string; done: boolean }>;
};
```

该 task 不得摄取 Figma、调用 Figma MCP、创建 design-system 文件、生成 prototype 代码，或编辑用户项目。它只验证 Runtime -> real external Agent -> Runtime -> Browser UI 能通过现有 task lifecycle 完整跑通一次。

## User stories covered

- 64
- 65
- 66
- 73
- 75

## Acceptance criteria

- [ ] Ikran Runtime 可以为 `real_agent_smoke` task 运行一个已配置的真实外部 Agent CLI command，且不改变现有 Browser UI -> Runtime API contract。
- [ ] smoke task 会向外部 Agent 发送一个小的结构化 payload，并要求 Agent 返回符合 smoke result schema 的 JSON。
- [ ] result 复用现有 task lifecycle：task creation、running/completed/failed state、SSE task events、schema validation 和 event persistence。
- [ ] Browser UI 可以触发 smoke task，并通过现有或最小 diagnostic task surface 观察 status/result；这不得在没有 Figma direction 的情况下引入最终 React Flow workbench UI。
- [ ] invalid JSON、non-zero exit、stderr-only failure、timeout 或 missing command 都产生诚实的 failed task state；Runtime 不发明成功 smoke result。
- [ ] smoke path 明确不需要 Figma MCP，也不读取或写入 prototype/design-system artifacts。
- [ ] 自动化覆盖使用 fake local CLI command，因此 CI 不依赖 Codex、Claude Code、Cursor、网络访问或用户凭据。
- [ ] 有一段 manual note 说明如何在本地把同一个 smoke task 指向一个真实已配置 Agent CLI。

## Blocked by

- `03-mocked-agent-task-runner.md`

## Manual note — pointing the smoke task at a real Agent CLI locally

The automated e2e (`tests/real-agent-smoke.spec.ts`) uses a deterministic,
offline fake local CLI (`tests/fixtures/smoke-fake-cli.mjs`) so CI never
depends on Codex / Claude Code / Cursor, the network, or user credentials.

To run the **same** `real_agent_smoke` task against a real configured Agent
CLI on your own machine, point the common smoke runner at it via two env vars
(read by `lib/runtime/adapters/cli-adapter.ts` → `resolveCliCommand()`):

```sh
# Example: point the smoke runner at a real headless Agent CLI locally.
# The runner spawns `<COMMAND> <ARGS...>`, writes the JSON TaskPayload to the
# child's stdin, and requires the child to print RealAgentSmokeResult JSON
# to stdout. Non-zero exit / stderr-only / non-JSON / hang all fail honestly.
export IKRAN_AGENT_CLI_COMMAND="codex"            # or: claude, cursor, node
export IKRAN_AGENT_CLI_ARGS='["--json","--smoke"]' # JSON array, or whitespace-split
npm run dev
# Then trigger a `real_agent_smoke` task via the existing task surface
# (POST /api/tasks with { family: "real_agent_smoke", payload: { input: {...} } }).
```

The runner is CLI-binary-agnostic: changing the command/args does NOT change
the runner. The Agent must return JSON conforming to the smoke result schema:

```ts
type RealAgentSmokeResult = {
  message: string;
  checklist: Array<{ label: string; done: boolean }>;
};
```

The runner validates the Agent's stdout against this schema at the existing
intake point (pass → `done`, fail → `failed`/`invalid_output`).

**Out of scope here (owned by Issue 14):** hardened/configurable CLI adapter,
the exact `--output-schema`/`--json-schema` flag convention, multi-provider
profiles, the one-repair loop (Issue 13), and real Figma-MCP smoke (Issue 16).
This 3A slice only proves one real Agent round-trip flows through the same
task/SSE path the mocked adapter already proved — honestly, with no Figma and
no project artifacts written.
