# Optional Visual Reference New Prototype Path

## What to build

为 new prototype loop 增加可选 visual reference 输入。Visual reference 可由用户提供或由 Agent host 的工具处理，但 Runtime 仍零 Figma 接触，不重新引入 Runtime Figma validate/oEmbed。该 reference 只增强新原型创建，不改变人类意图优先的主路径。

## User stories covered

- 40, 41, 42

## Acceptance criteria

- [ ] New prototype form 支持 optional visual reference field。
- [ ] 没有 visual reference 时 human-intent path 正常工作。
- [ ] 有 visual reference 时 Runtime 将其作为 context reference 记录并传给 Agent。
- [ ] Runtime 不访问 Figma，不解析远程 Figma 数据。
- [ ] Agent 声明由 visual reference 影响的新 prototype artifacts/run。
- [ ] 测试覆盖无 reference、有 reference、无效 reference、不触发 Runtime Figma contact。

## Real Agent validation

- [ ] 真实 Agent 使用一个 optional visual reference 创建或调整新 prototype。
- [ ] 验证 Runtime 只记录 reference，不直接摄取 Figma。

## Likely difficulties for Agent

- Visual reference 容易被误解为新的 seed extraction。
- Agent 可能尝试让 Runtime 访问 Figma 或下载远程资源。
- Visual reference 可能覆盖当前 design system，导致新原型偏离已确认规则。

## Suggested ways through

- UI copy 明确 visual reference 是 optional layout/reference input，不是重新 seed。
- Tool schema 中将 reference 标成 opaque designer-provided context。
- Agent output 必须说明 reference 如何受当前 design system 约束。

## Blocked by

- `13-human-intent-new-prototype-loop.md`
