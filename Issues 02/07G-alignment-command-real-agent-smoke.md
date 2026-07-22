# 07G — Alignment Command Staged Real-Agent Smoke

**Status:** complete

## Parent

- `07-design-intent-alignment-six-part-gate.md`

## What to build

用真实 Workbench 与真实 Agent host 验证本阶段的完整 designer–Agent handoff：Agent 在设计师控制边界进入 adaptive wait，设计师点击 `Next phase` 后同一 active turn 准备六部分问题；设计师在 Workbench 中思考、回答并点击 `Complete`，Runtime 立即进入 Initial Design System preparation，并让仍在等待的 Agent 或稍后的 Agent turn 接续 durable command。与此同时验证返回 Seed Reference 会废弃旧 attempt、刷新/断线不会丢状态，以及 portable baseline 不依赖替代 headless Agent。

真实 smoke 与 deterministic automated suite 必须分开报告。07F 的 host activation 调查可提供附加证据，但不是本 ticket 的 blocker，也不是 portable MVP 通过条件。

## Visual scope

本 ticket **无产品视觉范围**。仅使用 07A–07E 已接线的现有 Workbench surfaces 完成自动化与真实 Agent 验证；不得为了通过 smoke 新增测试专用按钮、状态面板、倒计时、banner、toast 或其他可见 UI。

## Acceptance criteria

- [x] deterministic one-process vertical 覆盖：Agent wait → Workbench `Next phase` → snapshot/attempt/command → MCP 问题准备 → SSE `answering` → Workbench 回答/`Complete` → Initial Design System command → reload 后状态保持。
- [x] 真实 Agent host 在 `Next phase` 前进入 wait；Workbench engaged signal 能把三分钟 deadline 滚动延长，设计师点击后 command 返回同一 active turn，Agent 基于实际 snapshot 生成六部分问题。
- [x] 真实设计师可以在 `answering` 中自由切换六部分并停留思考；保持 engaged 时 Agent 可以继续等待 `Complete`，idle 时 Agent 正常结束等待且 workflow 不自动前进。
- [x] 点击 `Complete` 后 Runtime 无论 Agent 是否仍在线都立即进入 Initial Design System preparation；active waiter 能接续 command，或下一 Agent turn 能首先恢复 pending command。
- [x] 至少一次 smoke 从 `preparing` 或 `answering` 返回 Seed Reference，证明旧 attempt/问题失效、新 `Next phase` 生成新 snapshot 和完整问题集，旧 Agent 写入不能污染新 attempt。
- [x] Runtime 重启、Workbench reload 与 MCP transport 断开后，current attempt、workflow stage 和 pending command 均能恢复；presence 本身不被恢复为研究状态。
- [x] 没有任何通过项依赖 Runtime spawn 独立 headless Codex/Cursor/Claude worker；若额外测试 07F 认可的 host activation，结果单独列出且不替代 wait/fallback 验证。
- [x] 报告分别列出 automated、真实 Agent、host-specific activation、blocked 与 not attempted，不用 deterministic client 冒充真实 Agent host。
- [x] 完整项目检查通过，并对 command durability、stale-attempt rejection、三分钟 fake-clock 边界和 successful export exclusion 保留回归覆盖。

## Blocked by

- `07A-runtime-owned-alignment-handoff.md`
- `07B-agent-command-alignment-preparation.md`
- `07C-adaptive-agent-wait-workbench-presence.md`
- `07D-alignment-attempt-abandon-regenerate.md`
- `07E-complete-initial-design-system-handoff.md`

## Completion report — 2026-07-23

新增 `tests/alignment-command-staged-smoke.spec.ts`，在一进程 Runtime/MCP + 真实 Workbench 中串起 adaptive wait、Next phase、attempt 废弃/重生成、12 个 MCP 问题、SSE answering、六部分切换、回答、Complete、下一 command、reload、MCP 断线和 Runtime 重启恢复。真实 host-native Codex Agent 在 `Next phase` 前进入同一次原生 wait；一次 Workbench engaged interaction 把三分钟窗口滚动延长，wait 实际持续 234,604 ms 后返回 `prepare_design_intent_alignment`。该 Agent claim 实际 immutable snapshot，为六部分各创建 2 个带 proposed answer 与合法 whole-surface evidence anchor 的问题，并 finalize 到 `alignment-answering`。

Browser Use 随后逐一切换六部分并保存设计师编辑答案；第二次原生 wait 先阻塞，再由 Workbench `Complete` 唤醒并返回 pending `prepare_initial_design_system`，语义只读核对为 `initial-design-system-preparing` / Alignment `completed`。重载后完成态与 pending command 保持。双轴审查补齐 stale title/anchor rejection、immutable snapshot anchor、2–5 词标题/问句/重复正文校验、abandoned research-event selection、wait 读异常隔离与显式失败语义、React remount presence，以及 designer-only Complete 边界；完整 `npm run check` 通过 521 项 unit 与 71 项 Playwright。全程未启动 headless Agent、未用 deterministic client 冒充真实 host，也未新增任何产品视觉范围。详细分项证据见 `docs/manual-agent-smoke-issue07.md`。
