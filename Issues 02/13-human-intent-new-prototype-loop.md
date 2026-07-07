# Human-Intent New Prototype Loop

## What to build

实现 seed startup 后的主要循环：设计师输入新的 prototype intent，Agent 消费当前 design system 创建新 prototype code，声明 source artifacts 和 preview，Runtime 创建 prototype run record 和 Prototype Evidence Surface，Workbench 显示 live iframe。

此 slice 验证设计系统是否能被用于新设计，而不是只重建 seed page。

## User stories covered

- 39, 41, 42

## Acceptance criteria

- [ ] Workbench 提供 human-intent new prototype 输入入口。
- [ ] Runtime 将当前 design-system context、relevant artifacts、intent 组织为 Agent 可用任务上下文。
- [ ] Agent 创建或更新 prototype code，并声明 source artifacts。
- [ ] Runtime 创建 prototype run record。
- [ ] Workbench 显示新的 Prototype Evidence Surface 和 live iframe preview。
- [ ] 新 prototype run 链接到 design-system version。
- [ ] 测试覆盖 intent submit、artifact declaration、preview update、run metadata linkage。

## Real Agent validation

- [ ] 真实 Agent 使用当前 design system 创建一个新 prototype surface。
- [ ] Agent 声明 artifact 和 preview。
- [ ] 手动验证新 prototype 不是只靠 prompt memory，而是引用 design-system source/context。

## Likely difficulties for Agent

- Agent 可能忽略 design system，直接按用户 intent 自由设计。
- 多个 prototype run 的 preview URL 和 source files 容易混淆。
- 新原型可能破坏 seed prototype 的 dev server 或路由。

## Suggested ways through

- Agent context packet 明确列出 design-system version、token paths、component constraints。
- Prototype run record 必须包含 run id、source paths、preview path、design-system version。
- 鼓励路由或目录隔离不同 prototype run，避免覆盖 seed reconstruction。

## Blocked by

- `09-draft-design-system-derived-view.md`
- `10-seed-prototype-preview-record-preview.md`
- `12-rule-update-proposal-confirm-cancel.md`
