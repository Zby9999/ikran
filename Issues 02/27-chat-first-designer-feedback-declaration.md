# 27 — Chat-First Designer Feedback 声明通道

Status: implemented（Real Agent validation 待做）

## What to build

设计师与 Agent 的开放交互留在 Agent host chat(沿用 Issue 07 决策:Workbench 不加通用 chat/thread UI)。本 issue 建立从 chat 到 Runtime 的声明式窄通道:多轮交互中每当达成一个**修改结论**,Agent 立即通过 MCP 工具声明一条 `designer_feedback` 记录,Runtime 校验并落库(SQLite 语义事件,`.ikran/` 侧)。

核心语义:**交互信息只有两种命运——在当下对话里指导当下设计(易失,随会话结束天然消失),或经设计师审查被提升为 Design System Rule(持久,唯一的长效影响)**。反馈库本身永远不是生成输入,只是审查素材。

由此产生两条硬边界:

- **只写不读**:交互过程中反馈库只写不读;只有设计师发起 Rule Update 审查(Issue 29)时,Agent 才全量读取反馈库。
- **生成隔离**:设计生成链路(包括新设计 run,见 Issue 13)的任何工具不得暴露反馈库读取入口。只有正式进入 Design System source 的信息才能影响新设计决策——反馈想影响未来设计,唯一路径是经 Issue 29 审查提升为 Rule。

Runtime 无法硬禁止宿主 Agent 直接读 `.ikran/` 文件,生成隔离的 enforcement 分三层:生成链路工具不提供反馈读取入口;`IKRAN_MCP_INSTRUCTIONS` 增加行为底线;物理分离(反馈存 `.ikran/`,`design-system/` 目录只放已提升的 Rule)。

## 记录契约

- 声明单位是"一个修改结论",不是每一轮对话。多轮交互收敛出的结论声明为一条。
- 每条记录携带:feedback id、summary、可选 linkage(evidence surface / prototype surface / region / seed reference ids)、run/session 分组标记、时间戳、可选 opaque context(如宿主浏览器标注产生的 DOM selector——Runtime 原样存储,不校验、不做坐标映射)。
- Runtime 校验:声明的 linkage id 若给出,必须存在于对应记录表(校验范畴与 `propose_rule_update` 的 evidence 校验一致);伪造 id 拒绝。
- 事件:`designer_feedback_recorded`,与 record 同 SQLite 事务。
- `designer_feedback` 记录加入 rule update proposal 的 evidence 校验白名单(Issue 22 落地的五类之外新增一类)。

## User stories covered

- 42, 43, 44

## Acceptance criteria

- [x] 新增 `record_designer_feedback` MCP 工具:Agent 声明修改结论,Runtime 校验并落 `designer_feedback_recorded` 事件(record + event 同事务)。
- [x] 记录携带 summary、可选 linkage、run/session 分组、时间戳、可选 opaque context。
- [x] 伪造 linkage id 的声明被拒绝。
- [x] `designer_feedback` 进入 `propose_rule_update` 的 evidence id 校验白名单。
- [x] 设计生成链路的工具与上下文 payload 不包含反馈库读取入口。
- [x] `IKRAN_MCP_INSTRUCTIONS` 增加行为底线:设计生成只消费 design-system source,不读交互反馈记录;达成修改结论即声明。
- [x] 测试覆盖:声明与事件落库、伪造 linkage 拒绝、白名单校验、生成链路 payload 不含反馈读取。

## Real Agent validation

- [ ] 真实 Agent 与设计师进行多轮 chat 修改后,逐结论声明 feedback 记录,Workbench/事件日志可见。
- [ ] 未发起审查时,真实 Agent 在新设计任务中不读取反馈库(通过任务上下文与工具边界验证)。

## Likely difficulties for Agent

- Agent 忘记即时落库,对话结束后凭记忆补声明,summary 失真。
- Agent 把每一句话都声明成一条记录,反馈库噪声化,审查时分组困难。
- Agent 在生成新设计时主动读 `.ikran/` 下的反馈记录文件——Runtime 无法硬禁止,只能靠工具边界 + instructions + 目录分离约束。

## Suggested ways through

- 工具描述与 instructions 明确"达成结论即声明;一条结论一条记录"。
- 声明时强制携带 run/session 分组,审查时按分组与 linkage 聚合,不靠事后语义聚类。
- 反馈记录写路径与 design-system source 读路径物理分离(`.ikran/` vs `design-system/`)。

## Blocked by

- `08-source-artifact-declaration-validation.md`
