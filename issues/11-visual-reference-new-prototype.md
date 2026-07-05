# 可选 Visual-Reference 新原型创建

## What to build

在初始 design system 存在后，加入可选 visual-reference 输入路径。设计师可以提供一个 visual reference 和 intent，Ikran Runtime 发送给 agent，生成的新 prototype 默认仍受当前 design system 约束，除非 task 明确记录 local exception 或 open gap。

## User stories covered

- 50
- 52
- 53
- 54
- 59

## Acceptance criteria

- [ ] new prototype flow 支持在人类 intent 之外附加一个 optional single visual reference。
- [ ] UI 仍将 human-intent-first creation 作为 primary path，visual reference 只是 optional aid。
- [ ] task payload 记录 visual reference、designer intent 和 current design-system version。
- [ ] mocked adapter 返回 prototype run metadata，以及与 reference 相关的 gaps、local exceptions 或 reusable candidates。
- [ ] 生成或更新的 prototype 通过与 human-intent creation 相同的 Prototype Evidence Surface / live iframe path 展示。
- [ ] reference-driven feedback 可以绑定到整个 prototype surface 或局部 prototype region。
- [ ] reference-driven findings 不会自动修改 formal design-system files。
- [ ] 测试验证 optional visual-reference path 不需要真实 Figma MCP。

## Blocked by

- `07-seed-prototype-live-preview.md`
- `08-design-system-browser.md`
