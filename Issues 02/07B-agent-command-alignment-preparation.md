# 07B — Agent command 驱动六部分 Alignment Preparation

**Status:** ready-for-agent

## Parent

- `07-design-intent-alignment-six-part-gate.md`

## What to build

让活跃或稍后恢复的 Agent 通过 Ikran MCP 领取 `prepare_design_intent_alignment` command，并基于该 command 绑定的 immutable snapshot 一次准备完整的六部分 Question card 集合。准备过程中已经生成的内容可以逐步投影到 Workbench 供设计师只读查看；只有 Agent 显式完成准备且六个 section 全部通过 coverage 校验后，attempt 才从 `preparing` 进入 `answering`，所有问题才可回答。

这个切片要让同一套 Runtime command kernel 同时服务 MCP Agent 与 HTTP/SSE Workbench，不引入 MCP 到 HTTP 的 loopback，也不要求 Runtime 自己运行模型。

## Visual scope

本 ticket **无新增视觉范围**。复用现有 Alignment stage panel、Question card、answer controls 和既有状态样式表达 `preparing` 与 `answering`；只读期间通过现有 disabled/read-only 能力以及非视觉 ARIA/data state 实现，不新增 spinner、banner、panel、card variant、布局、文案或动效。

## Acceptance criteria

- [ ] Agent 可通过语义 MCP surface 读取并领取 pending `prepare_design_intent_alignment` command；返回内容包含 attempt 与 snapshot identity，以及完成任务所需的稳定语义上下文。
- [ ] Agent 创建的 Question cards 全部绑定当前 attempt 与 snapshot evidence；每个 section 有二到五个有效问题，并继续满足 Issue 07 的标题、anchor、proposed answer 与 schema 约束。
- [ ] Agent 可分批提交问题；`preparing` 期间已提交内容在 Workbench 中只读可见，不能提前回答、接受 proposed answer 或点击 `Complete`。
- [ ] 只有六个 section 全部满足数量与有效性要求时，Agent 才能显式 finalize preparation；finalize 与 command completion 在一致的持久化边界内把 attempt 变为 `answering`。
- [ ] 进入 `answering` 后，设计师可以自由切换、提前查看和回看六个 section，并按 Issue 07 的规则回答问题。
- [ ] command claim、问题提交和 finalize 均可安全重试；重复 delivery 不复制卡片，过期或非 current attempt 的 Agent 写入被明确拒绝。
- [ ] Agent/MCP 断开不会删除已经提交的问题或 pending command；恢复后可以从 durable state 继续，而不是从聊天记录猜测进度。
- [ ] preparing/read-only/answering 的实现只改变现有控件行为和非视觉状态语义，不新增或重新设计任何可见 surface。
- [ ] one-process vertical test 覆盖 MCP claim/写入/finalize、HTTP read、SSE projection，以及从只读 `preparing` 到可回答 `answering` 的完整状态边界。

## Blocked by

- `07A-runtime-owned-alignment-handoff.md`
