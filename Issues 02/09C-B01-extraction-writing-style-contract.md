# 抽取写作风格契约（rich 字段反散文约束）

Status: resolved

## Parent

- `09B-initial-design-system-extraction-completeness.md`

## What to build

把"写作风格"写进 Agent 抽取时可见的契约面，使 09B 抽取产物的 rich 字段
（layout 的 `relationship` / `responsiveBehavior` / `acceptanceChecks`，以及
interaction / component 的同类字段）默认产出**紧凑约束清单**而非多句散文。

动机：schema 目前只校验这些字段"存在即为数组"，对内容形态零约束，导致
Agent 把设计师的简短中文 annotation 自由扩写成英文散文（实例：ikran
test 7 的 layout-rules.json）。散文对设计师审批（要读自己没写过的英文
长句）和未来 Agent 生成消费（事实与理由混杂、信噪比低）都是负资产。
旧版 self-improve-design workflow 已有成熟纪律（一句一规则、事实进结构化
字段、禁止 padding、理由归 rationale），但没有被带进 Ikran 的契约面。

本 ticket 只改 instruction / contract 层，**不引入新的 schema 硬校验**——
rich 字段保持 soft contract。需要落在 Agent 抽取时一定会读到的位置：

- MCP server instructions：为 layout / interaction / component 的 rich 字段
  各加写作风格约束与一组 good / bad 对照示例；
- 09B source contract 的字段说明同步补充（Agent 通过
  `claim_initial_design_system_preparation` 拿到）；
- 09B issue 文档补充风格条款，保持三处一致。

风格约束的内容：

- 每条数组项 = 一个短约束句（祈使或陈述，一句一条），禁止多句散文；
- 可结构化的空间 / 数值事实用结构化值表达（如 `"96 → 56px"` 这类紧凑
  记法或独立 key），不埋进句子；
- 解读、理由、设计意图写进 `meaning`（仍是一句话），不进规则字段；
- 语言跟随设计师原文语言（设计师写中文则规则写中文）；
- 禁止重述已有规则、禁止 padding、无证据支持的推测不写入（进 open
  questions）。

## Acceptance criteria

- [ ] Agent 经 MCP 抽取时可见的 instructions 中包含 rich 字段写作风格约束，
      且附 good / bad 对照示例
- [ ] source contract 的字段说明与 09B issue 文档同步更新，三处表述一致
- [ ] 约束覆盖：一条一句、事实结构化、理由归 meaning、跟随设计师语言、
      禁止 padding / 重述 / 无证据推广
- [ ] 未新增 schema 硬校验（`validateRulesFile` 行为不变），相关测试保持绿

## Blocked by

None — can start immediately（执行顺序第一棒：先立契约，再重写数据，最后改 UI）。

## Comments

- 2026-08-01：由子代理（gpt-5.6-sol）实施完成，commit 39fccf6。三处契约面
  （MCP instructions、source contract、09B 文档）已同步；typecheck + 269 项相关
  测试全绿；validateRulesFile 行为不变（soft contract）。摘要：/tmp/09C-B01-summary.md。

- 2026-08-01：结论来自对旧版 workflow（Skill Test）与当前 repo 消费链路
  的双边探索：rich 字段的拆分本身有意义（09B 覆盖校验与未来 Issue 10/13
  的生成消费），问题仅在内容形态无约束。探索报告要点见本 issue 的
  Comments 记录时点对话。

## Completion report

- 已在 MCP instructions、`INITIAL_DESIGN_SYSTEM_SOURCE_CONTRACT` 和 Parent issue
  09B 中同步写入一句一条、事实结构化、理由归 `meaning`、跟随原文语言及
  禁止 padding / 重述 / 无证据推广的 soft contract，并补齐 layout、interaction、
  component 的 good / bad 示例。
- `validateRulesFile` 未增加内容硬校验；回归测试明确保留原有 schema 行为。
- `npm run typecheck` 通过；相关 unit tests 共 13 个文件、269 项全部通过。
- 实施 commit：`39fccf6eced4a774778c68fa342932506574dcea`。
