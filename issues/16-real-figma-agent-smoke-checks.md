# 真实 Figma 与真实 Agent Smoke Checks

## What to build

加入 experiment-readiness smoke checklist。使用一个真实 seed page、一个已配置 Figma MCP access 的外部 agent 环境，以及至少一个 headless CLI adapter smoke run，确认 mocked workflow 的假设在真实工具下仍成立。

## User stories covered

- 1
- 4
- 44
- 45
- 46
- 66
- 72
- 74

## Acceptance criteria

- [ ] 使用真实 Figma seed page 验证 Figma structured evidence 能产生 anchored question cards 和 Figma Region Annotations。
- [ ] 验证 Agent 的设计系统抽取和 seed prototype 重建依赖 Figma structured evidence，而不是截图转代码。
- [ ] 使用已配置的 external agent environment 提供 Figma MCP access；Ikran Runtime 不实现 Figma MCP。
- [ ] 至少一个真实 headless CLI adapter path 通过 Ikran Runtime task lifecycle 被 smoke-tested。
- [ ] 使用真实空 project folder 验证 Next.js、TypeScript、Tailwind CSS、npm 的 prototype initialization。
- [ ] 手动验证 iframe 和 focus mode 中的 live preview。
- [ ] 手动验证 prototype region selection 可以产出 bounding box、selected crop，以及可用的 DOM candidates。
- [ ] visual and interaction acceptance notes 记录 seed reconstruction 是否能作为可用 live prototype 被检查。
- [ ] 真实集成限制被记录为 open gaps，而不是被 mocked success 掩盖。

## Blocked by

- `14-headless-cli-agent-adapter.md`
- `15-mocked-full-workflow-test.md`
