# Rules Schema Contract: Retire Rich Rule Fields

Status: resolved

## What to build

expand–contract 的收尾:从 schema 中移除规则富字段词汇(`statement` / `description` / `behavior` / `accessibility` / `relationship` / `responsiveBehavior` / `tokenLinks` / `acceptanceChecks`),规则 body 只保留散文形态。按 ADR 0005,`tokenLinks` / `acceptanceChecks` 不迁移、直接删除——未来 proposal 流程需要 affected items 时由 Agent 在提议时刻从全量规则现算。

存量内容:样本/夹具文件迁移为散文形态(富对象的正文字段并入 body),或用新形态重新抽取验证。迁移后的 schema 对旧富对象形态给出清晰的错误信息,而不是含糊的类型失败。

## Acceptance criteria

- [x] schema 只接受散文 rule body;旧富对象形态报出明确指向迁移方向的错误信息。
- [x] 样本与测试夹具迁移完成;真实重新抽取产出的规则为散文形态。
- [x] 代码中不再存在对已删字段的读取(渲染、投影、导出)。
- [x] `npm run check` 全绿;e2e 覆盖"旧形态文件 → 明确报错"路径。

## Blocked by

- 21-rules-projection-retirement(渲染侧已不再读富字段)
- 22-rules-taxonomy-soft-constraint-self-audit(声明侧已不再写富字段)

## Answer

规则 schema 已 contract 为非空散文字符串；旧对象返回 `legacy_rule_body_requires_prose`，并携带合并正文、保留 layout `sourceCaptures` 的迁移说明。富字段常量、source contract 词汇及渲染/投影/导出读取均已删除，样本、fixture 与 `.scratch/layout-live/stage.ts` / `stage.mjs` 已迁移。

真实项目副本重新声明后，Global Principles、Interaction 与 Layout 均以散文形态 ingest 并在真实 Workbench 中显示；Layout 的截图 provenance 继续独立 round-trip。最终 `npm run check`：93 个测试文件、889 个单元测试、80 个 Chromium e2e 全部通过；旧对象 MCP 路径返回明确迁移错误。两轮并行代码复审达到 `No findings` 固定点。
