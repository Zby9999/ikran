# Prototype Region Context 与 DOM Inspection

## What to build

在 live Prototype Evidence Surface 上支持 prototype Region Annotation。设计师可以选择 iframe 可视区域，Runtime 生成 bounding box、normalized rect、selected crop，并尽量通过 preview proxy 注入脚本和 postMessage 获取 DOM candidates。DOM inspection 失败时，Region Annotation 仍有效。

此 slice 产出可供 Agent 使用的 prototype region context packet。

## User stories covered

- 37, 38

## Acceptance criteria

- [ ] Workbench 支持在 Prototype Evidence Surface 上创建 prototype-region annotation。
- [ ] Prototype region 必须包含 bounding box 和 normalized rect。
- [ ] Runtime 可生成 selected crop 或等价局部视觉 context。
- [ ] DOM candidates 可选，包括 selector/id/data 属性、候选 component id、element bounds、overlap ratio。
- [ ] DOM inspection 失败时 annotation 仍创建成功，并记录 missing DOM context。
- [ ] Agent 可通过 MCP/record id 获取或接收 prototype region context packet。
- [ ] 测试覆盖 DOM success、DOM failure、invalid rect、context packet shape。

## Real Agent validation

- [ ] 真实 Agent 消费一个 prototype region context，返回解释、修复计划或创建后续 feedback/proposal。
- [ ] 使用真实 preview 页面手动验证 region 与 DOM candidates 是否合理。

## Likely difficulties for Agent

- iframe 坐标、viewport 坐标、devicePixelRatio 和 screenshot crop 容易错位。
- 跨 origin 或 sandbox 会导致 DOM inspection 不可用。
- Agent 可能过度相信 DOM candidates，而忽略视觉 crop。

## Suggested ways through

- Context packet 同时包含 visual crop、normalized rect 和 DOM candidates，并标注 confidence。
- DOM candidates 是 optional enhancement，不是 annotation 创建前置条件。
- Playwright 测试用固定 viewport 和简单 DOM fixtures 验证坐标。

## Blocked by

- `10-seed-prototype-preview-record-preview.md`
