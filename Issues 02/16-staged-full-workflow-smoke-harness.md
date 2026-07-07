# Staged Full Workflow Smoke Harness

## What to build

创建汇总性的 staged full workflow smoke harness。它不是把真实验证推迟到最后，而是收集并复跑每个阶段已经存在的真实 Agent 接入点：Workbench URL、project binding、MCP tool discovery、Figma evidence declaration、Region Annotation、Design Intent Alignment、source artifact declaration、design-system view、preview、prototype region context、rule update、新 prototype 和 export。

完成后，应能说明每个阶段是否有真实 Agent 通过、是否只有 mock 通过、是否存在 host/Figma/schema/open gap。

## User stories covered

- 64, 65, 66, 67, 68

## Acceptance criteria

- [ ] Smoke harness 列出每个阶段的真实 Agent validation checklist。
- [ ] Cursor 作为优先真实 host 跑通可用阶段。
- [ ] Codex Desktop 尝试关键 MCP tool discovery；若失败，记录具体 open gap 和 fallback。
- [ ] Harness 能引用每阶段产生的 smoke event、log 或 manual note。
- [ ] Harness 明确区分 pass、blocked、mock-only、not attempted。
- [ ] Full workflow mock e2e 仍可 deterministic 运行。
- [ ] 最终报告不把 mock success 伪装成真实 Agent success。

## Real Agent validation

- [ ] 复跑每个阶段的最小真实 Agent 接入点。
- [ ] 至少包含真实 Figma seed evidence、真实 source artifact declaration、真实 preview、真实 export 四类证据。

## Likely difficulties for Agent

- 汇总 issue 容易变成“最后才真实验证”，违背阶段验证原则。
- 不同 host 的失败原因不同，容易混在一起。
- 手动 smoke 结果如果没有结构化记录，后续研究不可复现。

## Suggested ways through

- 只汇总和复跑已有阶段 validation，不替代阶段内真实验证。
- 报告按 host 分组：Cursor、Codex Desktop、other。
- 每条 smoke result 写入事件、JSONL 或 markdown note，并链接到对应 issue/stage。

## Blocked by

- `05-agent-host-figma-evidence-declaration.md`
- `07-design-intent-alignment-six-part-gate.md`
- `09-draft-design-system-derived-view.md`
- `10-seed-prototype-preview-record-preview.md`
- `12-rule-update-proposal-confirm-cancel.md`
- `13-human-intent-new-prototype-loop.md`
- `15-research-event-export-undeclared-artifact-guard.md`
