# Rules Schema Contract: Retire Rich Rule Fields

Status: ready-for-agent

## What to build

expand–contract 的收尾:从 schema 中移除规则富字段词汇(`statement` / `description` / `behavior` / `accessibility` / `relationship` / `responsiveBehavior` / `tokenLinks` / `acceptanceChecks`),规则 body 只保留散文形态。按 ADR 0005,`tokenLinks` / `acceptanceChecks` 不迁移、直接删除——未来 proposal 流程需要 affected items 时由 Agent 在提议时刻从全量规则现算。

存量内容:样本/夹具文件迁移为散文形态(富对象的正文字段并入 body),或用新形态重新抽取验证。迁移后的 schema 对旧富对象形态给出清晰的错误信息,而不是含糊的类型失败。

## Acceptance criteria

- [ ] schema 只接受散文 rule body;旧富对象形态报出明确指向迁移方向的错误信息。
- [ ] 样本与测试夹具迁移完成;真实重新抽取产出的规则为散文形态。
- [ ] 代码中不再存在对已删字段的读取(渲染、投影、导出)。
- [ ] `npm run check` 全绿;e2e 覆盖"旧形态文件 → 明确报错"路径。

## Blocked by

- 21-rules-projection-retirement(渲染侧已不再读富字段)
- 22-rules-taxonomy-soft-constraint-self-audit(声明侧已不再写富字段)
