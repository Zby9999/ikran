# Rules Taxonomy Soft Constraint + Agent Self-Audit Conventions

Status: ready-for-agent

## What to build

分类边界从 schema 硬约束改为约定 + 自审。移除 interaction-rules 的字段白名单硬拒(它只能拦形状串味,拦不住语义误分类,且一条越界会让整个文件 ingest 失败)。把两条约定写进 MCP instructions 与相关工具描述:

1. 分类约定:什么内容属于哪个文件——跨组件策略进 interaction-rules,组件绑定行为进该组件的 spec,空间/布局规则进 layout-rules。
2. 自审约定:Agent 每次写规则时检查同文件已有规则的归置;发现错位时通过 rule-update proposal 通道(Issue 02/12)提议移动,绝不静默挪动。

设计师浏览作为兜底防线(ADR 0005)。

## Acceptance criteria

- [ ] 白名单硬拒移除;形状"串味"的内容不再导致整个文件 ingest 失败。
- [ ] MCP instructions / 工具描述包含分类约定与自审约定,措辞明确"错位走 proposal,不静默移动"。
- [ ] 真实 Agent 验证:让 Agent 从含组件级行为的证据中抽取规则,确认组件绑定内容进了组件 spec、跨组件内容进了 interaction-rules;人为制造一条错位,观察 Agent 是否以 proposal 形式提出移动。

## Blocked by

- 20-rules-prose-body(正文散文化后白名单已无所约束)
