# 07F — Agent Host Activation Feasibility Spike

**Status:** complete

## Parent

- `07-design-intent-alignment-six-part-gate.md`

## What to build

在 MVP 阶段调查 Codex、Cursor，以及具有可比官方接口的 Claude Agent host，判断 Ikran 是否能通过 host-supported API 或 CLI 安全地启动或恢复用户当前 Agent conversation 来处理 durable Agent command。调查必须用官方接口资料与最小可运行 probe 区分“恢复同一 host context”和“另外启动一个 headless worker”；后者即使能运行模型，也不能被当作满足 Ikran activation 要求。

本 ticket 只产出能力证据、兼容性矩阵和后续决策，不要求实现生产 Agent host adapter，也不阻塞 MVP 的 adaptive wait + pending command baseline。

## Visual scope

本 ticket **无产品视觉范围**。只允许创建隔离的技术 probe、调查记录和兼容性矩阵；不得修改 Workbench UI，也不得把 host-specific demo UI 作为 Ikran 产品设计。

## Acceptance criteria

- [x] 对每个调查 host 记录具体产品版本、调查日期、官方 API/SDK/CLI surface 与稳定性等级，避免把非公开 UI automation 当作正式能力。
- [x] 最小 probe 分别验证能否创建新 turn、恢复指定现有 conversation/task，以及把结构化 Agent command 交给该 turn；无法验证的项目明确标为 unknown，而不是推断为支持。
- [x] 逐项验证或记录限制：当前 workspace/worktree、conversation history、Ikran MCP、host Figma MCP、模型选择、用户认证、tool approvals、文件编辑能力、取消、状态与错误回传。
- [x] 明确测试 host idle 时是否存在官方 activation/event surface；区分 host-mediated activation、已有 active turn 的 MCP wait，以及 MCP server 反向注入。
- [x] headless CLI 可以作为差异对照，但不能因能启动独立 Agent 就判定通过；报告必须说明它是否继承用户当前 conversation、MCP 配置、Figma design context 与 approvals。
- [x] 不向仓库提交 host credential、token、个人 conversation 内容或其他 secret；probe 使用隔离 fixture，并记录所有外部状态变化。
- [x] 输出统一兼容性矩阵，将每个 host 归类为可安全做 adapter、能力有限需显式降级或当前不可用，并为判断附上可复现证据。
- [x] 若某 host 满足 activation 门槛，提出独立的 post-MVP Adapter implementation ticket；若不满足，确认该 host 使用 adaptive wait + durable pending command + next-turn resume，不修改 portable workflow contract。
- [x] 调查结论不得把 Adapter implementation 加回 MVP blocking path，也不得建议 Ikran 自建模型 runtime。

## Blocked by

- None — can start immediately and does not block the portable MVP path.

## 完成报告

已在 `docs/agent-host-activation-feasibility-2026-07-22.md` 固化 Codex、Cursor 与 Claude 的官方接口、安装版本、隔离 probe、统一能力矩阵和可复现边界。结论是 MVP 继续使用 adaptive wait + durable pending command + next-turn resume；Cursor/Claude 当前只有 headless 或用户侧 transport，不能当作反向唤醒。Codex App Server 具备 thread/turn/status/approval/cancel 的正确协议形态，但 live Codex Desktop continuity 仍未知，因此只新增独立 post-MVP `17-codex-app-server-activation-adapter-prototype.md`，不实现生产 Adapter、不改变 portable workflow，也不引入 Ikran 自建模型 runtime。真实 Agent Browser Use 审查确认现有 Workbench fallback 仍能进入 Runtime-owned `alignment-preparing`、pending command 可持久读取，且没有新增 host-specific 视觉或交互。
