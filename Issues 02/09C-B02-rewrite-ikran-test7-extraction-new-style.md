# 按新风格契约重写 ikran test 7 已有抽取产物

Status: resolved

## Parent

- `09C-B01-extraction-writing-style-contract.md`

## What to build

用 09C-B01 确立的写作风格契约，重写 ikran test 7 项目
`design-system/*.json` 中的散文式 rich 字段——以 `layout-rules.json` 为主，
同时检查 `interaction-rules.json` 与 `components/*.json` 的同类字段。

这是风格契约的首次实测验证：既清理存量数据，也检验契约是否足以指导
一次真实的重写。

要求：

- 每条 rich 字段重写为短约束句 / 结构化值，语言跟随设计师原文（中文）；
- 解读与理由并入 `meaning`，`meaning` 仍保持一句话；
- **语义不丢失**：重写前后逐条对照，凡是有证据支持的事实都要在新形态
  中找到落点；无证据的推测性内容移入 open questions 而非删除；
- `links`、status、evidence 引用、manifest 目标全部保持不变；
- 重写后经声明 → 校验 → ingest 链路入库，在 Browser 中确认展示为紧凑
  约束清单（若 09C-B03 已完成，则在 Atlas 视图中验证；否则在当前
  reader projection 中验证）。

## Acceptance criteria

- [ ] ikran test 7 的 layout-rules.json 每条 rich 字段为短约束句 / 结构化值，
      中文表达，无多句散文
- [ ] 重写前后逐条语义对照表（哪条旧句子去了哪个新字段 / open
      questions），无静默丢失
- [ ] links / status / evidence 引用不变；ingest 与 candidate → formalized
      round-trip 写回通过
- [ ] interaction-rules.json 与 components/*.json 的同类字段一并检查、按需
      重写
- [ ] 在 Browser 中人工走查确认展示效果（紧凑、设计师无需读英文散文）

## Blocked by

- 09C-B01（重写必须依据已确立的风格契约进行）

## Comments

- 2026-08-01：由子代理（gpt-5.6-sol）重写，主会话完成声明→ingest 并在 Browser
  走查验证。5 个文件、10 个 entry；123 项 rich 字段改写为中文短约束/结构化值，
  无证据推广移入 openQuestions；id/status/links/tokenLinks 经脚本比对不变。
  对照表：/tmp/09C-B02-mapping.md；摘要：/tmp/09C-B02-summary.md。

- 2026-08-01：ikran test 7 是当前唯一有完整 09B 抽取产物的真实项目，
  其 layout-rules.json 是散文式扩写的典型实例（设计师原文为简短中文）。
