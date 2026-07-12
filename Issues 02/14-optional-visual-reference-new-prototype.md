# Optional Visual Reference New Prototype Path

## What to build

为 new prototype loop 增加可选 visual reference 输入。该输入与项目用于 Design Intent Alignment 的 Seed Reference collection 不同：它只增强本次新原型创建，不重新开启 seed extraction，也不能覆盖已确认 design system。

如果 visual reference 是项目中已有的 Seed Reference，Runtime 复用其 current positional evidence 与 source identity；如果是新的 Figma selection，必须先走 ADR 0003 的标准 `add_seed_reference` capture 路径；非 Figma reference 可作为 opaque designer-provided context。不得增加绕过 Figma Connection Gate 的临时 Figma fetch。

## User stories covered

- 40, 41, 42

## Acceptance criteria

- [ ] New prototype form 支持 optional visual reference field。
- [ ] 没有 visual reference 时 human-intent path 正常工作。
- [ ] 选择已有 Seed Reference 时，Runtime 记录其 Reference id、current evidence version 与 prototype run linkage，并传给 Agent。
- [ ] 新 Figma selection 必须先通过标准 Seed Reference command 原子 capture；未连接、无权限或 capture 失败时不创建临时 visual-reference record。
- [ ] 非 Figma visual reference 仍可作为 opaque context，不能被误标为 Figma positional evidence。
- [ ] Agent 声明由 visual reference 影响的新 prototype artifacts/run。
- [ ] 测试覆盖无 reference、已有 Seed Reference、新 Figma selection、非 Figma opaque reference、无效/无权限 reference 与 design-system constraint。

## Real Agent validation

- [ ] 真实 Agent 使用一个 optional visual reference 创建或调整新 prototype。
- [ ] 验证真实 Figma visual reference 只通过标准 Runtime capture 路径进入，并且 Agent 仍按需通过 Figma MCP读取实现级 context。

## Likely difficulties for Agent

- Visual reference 容易被误解为新的 seed extraction。
- 实现可能新增绕过 Connection Gate/Seed command 的第二条 Figma fetch 路径。
- Visual reference 可能覆盖当前 design system，导致新原型偏离已确认规则。

## Suggested ways through

- UI copy 明确 visual reference 是 optional layout/reference input，不是重新 seed。
- Tool schema 区分 existing Seed Reference、new Figma selection 与 opaque non-Figma context。
- Agent output 必须说明 reference 如何受当前 design system 约束。

## Blocked by

- `13-human-intent-new-prototype-loop.md`
