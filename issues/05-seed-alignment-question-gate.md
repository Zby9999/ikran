# 五阶段 Seed Alignment 问题门

## What to build

把 seed evidence 转成设计师可操作的 alignment workflow。mocked agent 生成 PRD 定义的五个阶段中的必答 question cards；设计师可以查看每张卡、聚焦对应 Evidence Surface anchor、进行简短澄清对话、提交 final answer，并且只有全部卡片 answered 后才能解锁 seed-extraction gate。

## User stories covered

- 7
- 8
- 9
- 10
- 11
- 12
- 13
- 14
- 15
- 16
- 19
- 20

## Acceptance criteria

- [ ] Browser UI 渲染五个 seed alignment stages：Layout、Component Extraction、Interaction Style、Visual Style、Generalizability。
- [ ] 每个 stage 包含 2 到 5 张 mocked agent-generated question cards。
- [ ] 每张 card 包含 agent observation、agent question、conversation thread 和 final designer answer field。
- [ ] card state 只有 unanswered 或 answered；annotation type 不影响完成规则。
- [ ] 每张 card 必须引用 Region Annotation 或 whole-frame anchor，不能只使用“这里”等模糊描述。
- [ ] 选择一张 card 会聚焦 React Flow 工作区中对应的 Evidence Surface，并高亮 surface overlay 内的 anchor。
- [ ] 只有所有 card 都有 final designer answer 后，seed extraction 才能继续。
- [ ] seed extraction 完成后，Figma annotations 默认隐藏；选择 Figma Evidence Surface 或从 question/answer/research event 回看时重新显示。
- [ ] 记录 `question card created`、`designer answer submitted`、`seed extraction stage completed` 语义事件。
- [ ] 测试验证 completion gate 和 anchor focusing behavior。

## Blocked by

- `04-seed-evidence-canvas-annotations.md`
