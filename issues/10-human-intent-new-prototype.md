# Human-Intent 新原型创建

## What to build

实现 seed startup 后的主要循环：设计师用自然语言描述新的 prototype intent，Ikran Runtime 携带当前 design-system context 把请求路由给 agent，agent 在用户选择的项目文件夹中创建或更新 prototype code，live preview 更新，并生成可追踪的 prototype run record 和 Prototype Evidence Surface。

## User stories covered

- 49
- 51
- 52
- 53
- 59
- 73

## Acceptance criteria

- [ ] seed extraction 和初始 formalization/startup 完成后，Browser UI 默认展示 human-intent-first new prototype creation 作为主工作循环。
- [ ] 请求通过 Ikran Runtime 和 AgentAdapter 路由；Browser UI 不直接调用模型，也不直接读取 project files。
- [ ] agent task 接收或能够检索当前 design-system context，而不是只依赖 prompt memory。
- [ ] mocked adapter 创建或更新 prototype surface，并返回 prototype run metadata。
- [ ] Ikran Runtime 将 prototype run 链接到 design-system version，以及可用的相关 alignment answers。
- [ ] iframe preview 在 run 后更新，或显示 refreshed preview state。
- [ ] UI 将生成结果表现为 React Flow 中的 Prototype Evidence Surface。
- [ ] UI 允许设计师对整个 prototype surface 或局部 prototype region 给 feedback，以便后续 rule recursion 有触发来源。
- [ ] prototype feedback 同时链接 prototype run、prototype surface，以及可选 Region Annotation。
- [ ] 测试验证 task、run metadata、preview status 和 event linkage。

## Blocked by

- `07-seed-prototype-live-preview.md`
- `08-design-system-browser.md`
