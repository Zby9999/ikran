# 完整 Mocked Workflow 集成测试

## What to build

创建 PRD 中最高价值的测试边界：Browser UI -> Ikran Runtime -> mocked AgentAdapter -> project artifacts -> Browser UI render。该测试应证明完整 Ikran research loop 可以在没有真实 Figma MCP 和真实外部 agent 的情况下跑通。

## User stories covered

- 1
- 2
- 7
- 22
- 33
- 39
- 49
- 56
- 60
- 63
- 64
- 67

## Acceptance criteria

- [ ] 测试使用临时空 project folder。
- [ ] 测试完成 project binding、mocked seed evidence、React Flow Evidence Surface、Region Annotation overlay、alignment questions、designer answers、draft design-system artifacts、view JSON rendering、seed preview readiness、rule-update proposal path、new prototype run 和 research export。
- [ ] 测试验证 `.ikran/`、`workflow/design-system/`、`workflow/design-evidence/` 下的 durable artifacts。
- [ ] 测试验证 exported JSON/JSONL 包含 linked project、question、answer、evidence surface、region annotation、prototype 和 rule-update identifiers。
- [ ] 测试验证 research event model 不需要记录低层 UI 噪声。
- [ ] 测试验证 Figma region 和 prototype region 都能作为 Agent context packet 的稳定输入。
- [ ] 测试保持 deterministic，不依赖真实 Agent、真实 Figma MCP 或本地进程之外的网络访问。

## Blocked by

- `04-seed-evidence-canvas-annotations.md`
- `05-seed-alignment-question-gate.md`
- `06-draft-design-system-artifacts.md`
- `07-seed-prototype-live-preview.md`
- `08-design-system-browser.md`
- `09-contextual-rule-update-proposals.md`
- `10-human-intent-new-prototype.md`
- `12-research-event-export.md`
- `13-agent-output-validation-repair.md`
