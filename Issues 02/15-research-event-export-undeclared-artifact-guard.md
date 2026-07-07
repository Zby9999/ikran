# Research Event Export 与 Undeclared Artifact Guard

## What to build

提供 MVP research export：Runtime 将语义事件、canvas records、artifact index、Question card、designer answers、prototype runs、rule update proposals 导出到 `.ikran/export/`。导出必须保留 record linkage，并明确排除未声明 source artifacts。

此 slice 不只是导出 mock workflow；它必须包含至少一次真实 Agent 已声明 artifact/run/proposal 的 export 验证。

## User stories covered

- 46, 47, 48, 49, 50

## Acceptance criteria

- [ ] Export 生成 `.ikran/export/`。
- [ ] 最小导出包含 `events.jsonl`、`project-summary.json`、`alignment-questions.json`、`designer-answers.json`、`prototype-runs.json`、`rule-update-proposals.json`、`artifacts-index.json`。
- [ ] Export 保留 Evidence Surface、Region Annotation、Question card、answer、prototype run、rule proposal、artifact 的 linkage。
- [ ] 低层 pan/zoom/hover/keystroke 不作为 research events 导出。
- [ ] 未声明 source artifact 不进入 artifact index 或 export。
- [ ] Workbench 提供最小 export action 和 completion status。
- [ ] 测试覆盖完整 mocked workflow export、真实 Agent 声明 artifact export、未声明 artifact guard。

## Real Agent validation

- [ ] 使用至少一次真实 Agent 声明过的 source artifact、preview 或 proposal 生成 export。
- [ ] 手动检查 export 中包含真实声明链路，不包含未声明文件。

## Likely difficulties for Agent

- Export 容易只 dump 当前数据库，而忽略跨 record linkage。
- 未声明文件可能存在于项目中，Agent 可能期望它出现在 export。
- 真实 Agent smoke 产生的 open gaps 也需要进入研究记录。

## Suggested ways through

- Export 从 artifact index 和 event log 生成，而不是扫描项目文件夹。
- 对未声明文件输出 warning/open gap summary，但不纳入 artifacts-index。
- 将每阶段真实验证结果作为 semantic event 或 smoke note 纳入 export。

## Blocked by

- `07-design-intent-alignment-six-part-gate.md`
- `08-source-artifact-declaration-validation.md`
- `10-seed-prototype-preview-record-preview.md`
- `12-rule-update-proposal-confirm-cancel.md`
- `13-human-intent-new-prototype-loop.md`
