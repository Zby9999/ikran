# Staged Full Workflow Smoke Harness

## What to build

创建汇总性的 staged full workflow smoke harness。它不是把真实验证推迟到最后，而是收集并复跑每个阶段已经存在的真实 Agent 接入点：Workbench URL、project binding、MCP tool discovery、Figma evidence declaration、Region Annotation、Design Intent Alignment、source artifact declaration、design-system view、preview、prototype region context、rule update、新 prototype 和 export。

完成后，应能说明每个阶段是否有真实 Agent 通过、是否只有 automated/mock 通过、是否存在 host/Figma/schema/open gap。本 issue 同步目标与验收；**不声称已实现完成**。

### 2026-07-10 后续架构收口

分层测试：Vitest unit + Playwright MCP/HTTP/Workbench 边界；one-process / direct MCP（无 HTTP loopback）自动化 smoke；无全局 `pkill`。完整递归成功门槛与 Issue 15 / PRD 一致。报告必须区分 **automated** 与 **real**（真实 Agent host / 真实 Figma）；Issue 05 真实 Figma 在无证据前不得标为 real pass。详见 PRD 与 ADR 0002。

## User stories covered

- 64, 65, 66, 67, 68

## Acceptance criteria

- [ ] Smoke harness 列出每个阶段的真实 Agent validation checklist，并并列 automated checklist。
- [ ] Automated 层覆盖：Vitest unit、Playwright MCP/HTTP/Workbench 边界、one-process / direct MCP smoke；不使用全局 `pkill`。
- [ ] Cursor 作为优先真实 host 跑通可用阶段。
- [ ] Codex Desktop 尝试至少 MCP tool discovery；若失败，记录具体 open gap 和 fallback。
- [ ] Harness 能引用每阶段产生的 smoke event、log 或 manual note。
- [ ] Harness 明确区分 automated pass、real pass、blocked、mock-only、not attempted。
- [ ] Full workflow automated/mock e2e 仍可 deterministic 运行。
- [ ] 完整成功递归**入选门槛**（DS v1 → 新原型 → 反馈/确认 → DS v2 → 第二次新设计）在 harness 中可检查；未达门槛不得标为完整研究 export 成功；达标 export 抽检须含闭环前成功阶段。
- [ ] 最终报告不把 automated/mock success 伪装成真实 Agent / 真实 Figma success。

## Real Agent validation

- [ ] 复跑每个阶段的最小真实 Agent 接入点。
- [ ] 至少包含真实 Figma seed evidence、真实 source artifact declaration、真实 preview、真实 export 四类证据（与 automated 分列）。
- [ ] 真实 Figma 无证据时保持 not attempted / blocked，不继承 Issue 05 自动化完成状态。

## Likely difficulties for Agent

- 汇总 issue 容易变成“最后才真实验证”，违背阶段验证原则。
- 不同 host 的失败原因不同，容易混在一起。
- 手动 smoke 结果如果没有结构化记录，后续研究不可复现。
- 容易把 one-process automated smoke 误报为真实 Figma smoke。

## Suggested ways through

- 只汇总和复跑已有阶段 validation，不替代阶段内真实验证。
- 报告按 host 与层分组：automated / Cursor real / Codex Desktop real / other。
- 每条 smoke result 写入独立 smoke / operational report，并链接到对应 issue/stage；研究 export 仅对达标项目生成，且内容为整条成功语义链路（含闭环前阶段）及其 derived JSONL。

## Blocked by

- `05-agent-host-figma-evidence-declaration.md`
- `07-design-intent-alignment-six-part-gate.md`
- `09-draft-design-system-derived-view.md`
- `10-seed-prototype-preview-record-preview.md`
- `12-rule-update-proposal-confirm-cancel.md`
- `13-human-intent-new-prototype-loop.md`
- `15-research-event-export-undeclared-artifact-guard.md`
