# MCP Instructions 通道切分：行为底线、流程契约与方法论归属

Status: implemented（Real Agent validation 待做）

## Parent

- `03-semantic-mcp-tool-boundary-mock-client.md`
- `07B-agent-command-alignment-preparation.md`
- `09B-initial-design-system-extraction-completeness.md`
- `09C-B01-extraction-writing-style-contract.md`

## 背景

`IKRAN_MCP_INSTRUCTIONS`（`lib/mcp/shared.ts`）当前约 14.7KB，在 MCP initialize
握手时一次性下发，客户端通常原样注入 system prompt——agent 只要连着 server，这
一万多字就常驻上下文，不管它本次会话是否走 alignment / extraction。

MCP 协议对 instructions 没有渐进披露机制，但项目已有经过验证的按需通道：
`prepare_initial_design_system` 命令 payload 返回的 `source_contract`
（`lib/runtime/initial-design-system-preparation.ts`）。同一套写作纪律目前在
instructions 和 `source_contract` 里双份存在（P7 段），付"常驻 + 按需"两份成本。

2026-08-03 与设计师（issue 作者）确认三通道分工框架，本 issue 落实切分。

## 三通道分工（锁定框架）

分类测试：**这段内容被需要的时刻，以及违反它的后果。**

| 通道 | 内容性质 | 测试 |
|---|---|---|
| instructions（常驻） | 行为底线 + 路由指针 | 任何工具调用之前就必须知道；不知道就会走错路 |
| 工具描述 + 命令 payload（按需） | 结构化流程契约 | 只在执行某流程时需要；违反会产生 invalid / 低质输出 |
| Skills（宿主侧） | 判断方法论 | 关于"怎么思考"而非"格式是什么"；违反仍 valid 但平庸 |

硬约束：

- **正确性所必需的内容禁止只放 Skill**——Skill 依赖宿主能力，MCP server 无法假设
  消费方有 skill 系统；契约永远随 server 版本走。
- **契约与校验器同源**：被 Runtime 硬校验的规则（如 Question 标题 48 字符、三类
  evidence target）住在校验代码旁，随契约 payload 下发，不在 instructions 里手抄
  一份会漂移的副本。
- **单一事实源**：每条事实只存在于一个通道，其他通道只留指针。
- 全局行为纪律（回合模型、claim 消费、declare 义务、摄取路径唯一性）**不得**因为
  "大部分归 Tools" 而搬走——agent 不进入对应流程就永远看不到工具 payload。

## 现状内容映射（`shared.ts` P1–P8）

| 段 | 内容 | 去向 |
|---|---|---|
| P1 开场 | server 身份、open-and-wait 回合模型、claim 消费规则 | **instructions 保留**（压缩）；bind / path fail-closed 语义归 `create_or_open_project` 工具描述 |
| P2 Figma gate | 摄取路径唯一性、fail-closed | 唯一性压缩为 instructions 一行；capture/refresh 语义归各工具描述 |
| P3 Host Figma MCP | host 截图非 Active 摄取路径 | **instructions 保留一行** |
| P4 Annotations | target union | 归 `create_annotation` 工具描述 |
| P5 Adaptive wait | lease / renewal 语义 | 归 `wait_for_agent_command` 工具描述 |
| P6 Alignment | 六段顺序、先注记后提问、48 字符标题、2–5 卡、三类 target 模式及渲染语义 | **alignment prepare 命令 payload 新增 `section_contract`**（与 Runtime 校验同源）；instructions 留一行指针 |
| P7 DS preparation | claim 消费 | **instructions 保留**（它是回合模型的一部分）；kind/domain/typography 写作风格**删除重复**，留一行指向 `source_contract` |
| P8 Artifact 声明 | 写完文件必须 declare | 义务句 **instructions 保留一行**（它约束任何文件写入）；diagnostics / repair 细节归 `record_artifact_written` 工具描述与返回结构 |

## What to build

迁移切片（按序交付，每片可独立验证）：

- **S1 P7 去重**：删除 instructions 中与 `source_contract` 重复的 kind / domain /
  typography 写作风格全文，替换为一行指针；`source_contract` 成为唯一源。
- **S2 P6 payload 化**：alignment prepare 命令 payload 新增 `section_contract`，
  承载原 P6 全部硬规则（卡片数量、标题格式、target 模式、渲染语义、校验规则），
  常量与 Runtime 校验器同一定义处；instructions P6 收缩为一行流程指针。
- **S3 P2 / P4 / P5 / P8 修剪**：工具级语义迁入各工具描述；instructions 只留全局
  纪律行。
- **S4 终态瘦身核对**：instructions 收敛到目标体量（≤ 2KB），逐行核对保留清单，
  grep 验证无契约文本残留重复。

## Locked product decisions

- instructions 目标 ≤ 2KB，只含：server 身份一句、回合模型（open-and-wait +
  claim 消费）、全局义务各一行（摄取路径唯一、declare 义务、诚实纪律）、
  各流程一行路由指针。
- Color primitive / semantic 分层纪律**不在本 issue**（2026-08-03 设计师确认只做
  通道切分）；本 issue 建立的 `source_contract` 新位置即为该纪律将来的落点。
- Skills 通道本 issue **只定原则**，不创建任何 skill 文件；方法论内容暂留各 issue
  文档，宿主位置（`.kimi-code/skills` / `.cursor/rules` / 其他）后续再定。
- payload 只增不改义：Runtime 校验语义、工具集合、命令结构不变。
- Design System Browser 分栏退役与本 issue 无关（另由接手 agent 执行）。

## Acceptance criteria

- [x] `IKRAN_MCP_INSTRUCTIONS` ≤ 2KB，逐行属于锁定保留清单。
- [x] instructions 与 `source_contract` / `section_contract` / 工具描述之间无重复
      契约文本（grep 可验证，如 "48 characters"、"entry_kind_file_ownership" 只出现
      在唯一定义处）。
- [x] alignment prepare 命令 payload 携带 `section_contract`，覆盖原 P6 全部硬规则，
      且常量与 Runtime 校验器同源。
- [x] `source_contract` 覆盖原 P7 全部契约内容；instructions P7 只剩 claim 消费规则
      与一行指针。
- [x] Runtime 校验行为不变（拒绝规则、标题长度、target 解析等均无回归）。
- [x] 单测从"instructions 包含契约文本"改为"payload / 工具描述包含契约文本"
      （`tests/unit/initial-design-system-preparation.test.ts` 358–391 行等）。
- [x] 既有 e2e 无回归（`alignment-command-staged-smoke.spec.ts`、
      `design-intent-alignment-mcp.spec.ts`、`adaptive-agent-wait-mcp.spec.ts` 等）。

## 实施与验证记录（2026-08-03）

三通道落点：

- **instructions（`lib/mcp/shared.ts`）**：1819 字符 / 1823 字节，只含 server 身份、
  open-and-wait 回合模型、三条全局纪律（摄取路径唯一、declare 义务、不丢输入）与
  两个流程指针。
- **section_contract（`lib/runtime/design-intent-alignment.ts` 的
  `ALIGNMENT_SECTION_CONTRACT`）**：与 `ALIGNMENT_SECTION_QUESTION_MIN/MAX` 同源，
  随 `claim_alignment_preparation` 返回（fresh 与 reused 两条路径都装饰）。
- **source_contract（`lib/runtime/initial-design-system-preparation.ts`）**：原样保留，
  为 P7 契约唯一源；instructions 中重复的 kind / domain / typography 写作风格已删除。

实施中发现：多数工具级语义（P2 capture/refresh、P4 target union、P5 lease/renewal、
P8 diagnostics）在工具描述中**早已存在**，因此 S3 主要是删 instructions 的重复文本，
而非新建内容。

验证：

- `npx tsc --noEmit` 通过。
- `npx vitest run` 全量 91 文件 / 878 测试通过（含新增
  `tests/unit/mcp-instructions.test.ts`：体量上限、行为底线保留、指针存在、
  五个契约标记不外泄）。
- Playwright 3 spec 通过：`alignment-command-staged-smoke`、
  `design-intent-alignment-mcp`、`adaptive-agent-wait-mcp`。
- grep 核对："48 characters"、"Layout good:"、"entry_kind_file_ownership"、
  "TYPOGRAPHY ROLE WRITING STYLE"、"focus-target-set" 均不在 instructions 中。

Code review（Standards + Spec 双轴）后修复四点：

- 补回被误删的行为纪律"never use one designer-edited card to formalize
  unrelated claims"（P7 诚实条款，属行为底线，留在 instructions）。
- 标题词数上下限抽出 `ALIGNMENT_QUESTION_TITLE_MIN_WORDS/MAX_WORDS` 常量，
  校验器与 `section_contract.question_title`（新增 min_words/max_words 字段）
  同源，不再硬编码字面量。
- 工具描述中重复的契约事实（标题格式、每段卡数、target 模式及渲染语义）收敛为
  指向 `section_contract` 的指针，契约文本全仓库只在 payload 定义处存在。
- 体量测试改为按 UTF-8 字节断言（`Buffer.byteLength` ≤ 2048），匹配 2KB 预算语义。

Real Agent validation 两项仍未做：真实 agent 跑完整流程观察 payload 契约的发现性，
若出现"不知道要去读"的失败模式，需回填 instructions 指针措辞。

## Real Agent validation

- [ ] 真实 Agent 在新 instructions 下完成一次完整 alignment + initial design
      system extraction，确认契约经 payload 仍可被发现、输出质量无下降。
- [ ] 记录 Agent 是否主动从 payload 读取契约；若出现"不知道要去读"的失败模式，
      回填 instructions 指针措辞（这是本切分的主要风险点）。

## Open gaps

- Skill 文件宿主位置未定；方法论内容（如何拆原子 claim、如何判断"有意义假设"）
  暂留各 issue 文档，待宿主位置确定后搬迁。
- instructions 最终字节预算在 S4 实施时复核一次（2KB 是目标不是硬门）。

## Blocked by

- 无。（与进行中的 Design System Browser 分栏退役无文件冲突：本 issue 只动
  `lib/mcp/`、`lib/runtime/`、alignment / preparation 命令与对应测试。）

## Out of scope

- Color primitive / semantic 分层写作纪律的条款本身（后续内容决定，另立 issue）。
- 创建宿主侧 skill 文件。
- 改变 Runtime 校验语义、工具集合或命令结构。
- MCP Resources / Prompts 通道的引入（评估后未采用：resource 读取权在多数客户端
  属于用户而非模型，可靠性不如工具结果）。
