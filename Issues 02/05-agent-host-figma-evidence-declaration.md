# Agent-Host Figma Evidence Declaration

## What to build

退役 Runtime 侧遗留 Figma validate/oEmbed 路径已在 Issue 02/04A 完成。本 issue 改为：Agent host 使用自己的 Figma MCP 摄取 seed evidence，然后通过 `record_evidence_package` 声明给 Runtime。Runtime 只保存 seed reference、校验 evidence package schema、创建 Figma Evidence Surface record，并广播给 Workbench。

这个 slice 必须用真实 Figma seed page 做一次 Agent host 验证；mock 只能证明 schema 和 UI 路径，不允许掩盖真实接入失败。

## User stories covered

- 8, 9, 12, 64, 65

## Acceptance criteria

- [x] Runtime 不再调用 Figma oEmbed/API 做 seed validation。（由 Issue 02/04A 删除 `/api/figma/validate` 完成；本 issue 不再重复退役。）
- [ ] `record_evidence_package` 接收 Agent host 返回的 structured evidence package。
- [ ] Runtime 校验 evidence package schema，失败时记录 invalid-output 事件。
- [ ] 校验通过后创建 Figma Evidence Surface canvas record。
- [ ] Workbench 在 tldraw 中投影 Figma Evidence Surface。
- [ ] 测试覆盖 valid package、invalid package、Runtime 不触网访问 Figma。

## Real Agent validation

- [ ] 使用真实 Agent host + 已配置 Figma MCP + 真实 Figma seed page 生成最小 evidence package。
- [ ] Agent 通过 Ikran tool 声明 package，Runtime 创建 Figma Evidence Surface。
- [ ] 如果 Figma MCP 不可用、权限不足或截图/结构化证据缺失，必须记录 open gap 和缺失 evidence view。

## Likely difficulties for Agent

- 真实 Figma MCP 可能只返回 raw data 或 screenshot 中的一种 evidence view。
- Agent 可能把截图转代码当作主要输入，而不是 structured evidence。
- Evidence package schema 太严格会让真实 Agent 难以一次成功，太宽又会污染后续 design-system extraction。

## Suggested ways through

- 采用最小 evidence package：seed reference、frame/node identity、raw evidence availability、screenshot availability、surface bounds、关键 design signals。
- 缺失 evidence view 用 explicit missing 标记，不让 Agent 猜。
- 在 smoke 记录中区分 blocked by Figma access、blocked by schema、blocked by host MCP tool discovery。

## Blocked by

- `03-semantic-mcp-tool-boundary-mock-client.md`
- `04-tldraw-workbench-shell-seed-entry.md`
