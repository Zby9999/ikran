# Initial Design System Extraction Completeness 与 Semantic Coverage Gate

Status: resolved

> Protocol replacement (2026-08-05): Issue 26 replaces the atomic
> `record_design_system_extraction_manifest` contract below with progressive
> output work units plus a cross-section audit. The old tool, Agent-supplied
> `section`, and Agent-supplied `jsonPointer` are removed without compatibility;
> existing test extraction state is cleared and re-extracted. Keep the material
> below as the historical coverage rationale, but use
> `26-progressive-initial-design-system-extraction.md` for the current API and
> completion behavior.

## What to build

在 09 / 09A 已交付的全 JSON design-system source、DB ingest、derived
view 和 Design System Browser 之上，补齐 Initial Design System preparation
的真实 Agent 工作契约与完成门禁。

当前链路允许 Agent 在 Alignment 完成后直接写出一组“结构合法但内容极少”的
JSON。Runtime 能验证 artifact 存在、JSON shape、alias graph 和状态 link，却
不能发现已确认的字体、字阶、字距、灰阶、布局或组件边界被静默遗漏，也不能阻止
一个 entry 借用语义无关的 designer-edited card 获得 `formalized` 状态。

本 issue 要把 Initial Design System preparation 从一次松散文件写入，改为：

1. Agent 领取一个包含完整不可变输入的 durable command。
2. Agent 将 Alignment 输入拆成可审计的原子 design claims。
3. 每个 claim 必须映射到具体 design-system entry / JSON pointer，或显式记录为
   conflict / omitted，并说明原因。
4. Agent 写入并逐文件声明丰富的 design-system JSON source。
5. Runtime 在完成 command 前确定性校验 source coverage、目标存在性、状态资格和
   required artifact set。
6. Agent 做一次 extraction audit；Runtime 只在 coverage gate 通过后完成 command。

目标不是要求固定数量的 token 或组件，而是确保已有输入不会无声消失，并让
“为什么写入 / 为什么未写入”可追溯。

## Problem evidence

2026-07-29 的 08 / 09 / 09A 真实 Agent 验证项目暴露了以下问题：

- Alignment 的 Token Annotation 明确记录 `Instrument Sans`、`16–105` 字号范围和
  负字距，designer-edited answer 又确认以 Figma 变量为准并保留六档灰阶；最终
  `token.json` 没有任何 typography token。
- 同一张字体问题卡被用于支持 `color.ink`、`color.paper` 和 `space.unit` 的
  `formalized` 状态，但这些结论并不由该问题本身支持。
- Designer answer 表达 CTA 使用“标签 + 箭头”文字链接、不引入填充按钮；最终
  component spec 却生成“黑底白字主按钮”，并因同一张 edited answer 被整体标为
  `formalized`。
- 09 / 09A 的真实 Agent acceptance 只要求至少一个 foundation 和一个 component
  detail，因而最小产物也能被视为成功。
- Skill Test 5 的 prototype-first Workflow 会保留 design candidate、Context
  Ledger、semantic token、组件 anatomy / variants / states / usage rules、layout /
  interaction rules、prototype evidence 和 designer approval；当前 Initial Design
  System preparation 没有等价工作契约。

## Locked compatibility decisions

本 issue 不重新讨论或推翻 09A 的以下产品决策：

1. Design-system source 继续全部使用 JSON，不恢复 Markdown source islands。
2. Source 文件继续位于项目根 `design-system/`：
   - `design-system.json`
   - `token.json`
   - `component-list.json`
   - `components/<name>.json`
   - `layout-rules.json`
   - `interaction-rules.json`
3. 文件经 `record_artifact_written` 声明、schema validation 和 ingest 后进入 DB；
   Browser 继续读取 DB，不读取 `design-system-view.json`。
4. `design-system-view.json` 继续是 Runtime-owned derived export。
5. Entry 状态词继续是 `formalized` / `candidate` / `gap`；09A 的 candidate approval
   写回和 LWW event log 保持兼容。
6. Browser 继续使用 Foundations / Components Section Tabs 和底部 sheet。
7. Evidence chain 继续由 Runtime 实时 join，不把完整证据正文复制进 source files。

09B 只收紧 Initial Design System preparation 的输入完整度、entry 粒度、状态支持
范围和 command 完成条件。

## Durable command lifecycle

### `claim_initial_design_system_preparation`

新增专用 semantic MCP tool，领取当前
`prepare_initial_design_system` durable command。重复 claim 必须幂等，并返回：

- command id、alignment attempt id、input snapshot id；
- Project Design Language Description；
- snapshot 内全部 Seed References、Reference Notes 和 captured evidence versions；
- 六部分 Agent Annotations，包括 `confirmed` / `reasonable` inference；
- 所有 Question cards、final answers 和 answer sources；
- snapshot 内全部 Designer Annotations；
- captured node / surface identity 和宿主 Figma MCP 所需的 reference handles；
- 09A source file contract、schema version、required artifact set；
- 当前已声明 design-system artifacts，支持断线后恢复而不重复生成。

Runtime-owned positional evidence 仍是 Active ingestion source。宿主 Figma MCP 只用于
Agent 按需读取 implementation-level typography、variables、component 和 layout
context；claim tool 不伪造或缓存宿主 Figma MCP 的语义输出。

### `record_design_system_extraction_manifest`

新增 attempt-bound、idempotent semantic MCP tool，用于提交原子 extraction manifest。
Manifest 是 Runtime record，存入 SQLite 并进入 canonical semantic events；它不是
新的 design-system source file，也不改变 09A 的 source file layout。

每个 claim 至少包含：

```json
{
  "claimId": "stable-agent-authored-id",
  "section": "token",
  "statement": "The system uses Instrument Sans as its sole UI type family.",
  "sourceRecordIds": ["question-card-id", "agent-annotation-id"],
  "sourceExcerpts": ["..."],
  "confidence": "confirmed",
  "outcome": "mapped",
  "targets": [
    {
      "artifactPath": "design-system/token.json",
      "entryId": "primitive.fontFamily.instrumentSans",
      "jsonPointer": "/primitive/fontFamily.instrumentSans"
    }
  ]
}
```

`outcome` 只允许：

- `mapped`：已进入一个或多个 source entry；
- `conflict`：输入来源互相冲突，不能静默选择；
- `omitted`：不应进入 reusable design system，必须给出非空 reason；
- `gap`：该设计决策应存在但证据不足，映射到显式 gap entry。

Manifest 必须满足：

- 每张 answered Question card 至少被一个 claim 消费；
- 每条 Agent Annotation 和 Designer Annotation 至少被消费或显式 omitted；
- 所有 source record ids 必须属于同一 immutable Alignment snapshot；
- `mapped` / `gap` target 必须指向 09A source layout 内的稳定 entry id；
- 不得把 reference example、聊天历史或其他 attempt id 当作当前 evidence；
- 不得为了填满通用类别制造与 Seed 无关的 gap，例如没有图表需求时生成
  `chart.palette` gap。

### `finalize_initial_design_system_preparation`

新增显式完成工具。只有以下条件全部满足时，Runtime 才把 durable command 标记为
completed：

- extraction manifest 已记录并通过结构校验；
- required source artifacts 已全部声明并成功 ingest；
- `component-list.json` 中每个非 gap component 都存在对应 component spec，或 manifest
  对缺失 spec 有明确的 conflict / omitted 记录；
- manifest 中所有 `mapped` / `gap` targets 都能在 DB 当前 source version 中解析；
- 所有非 gap design-system entries 至少被一个 claim target 覆盖；
- 没有 confirmed claim 处于未处理状态；
- 没有未解决的 manifest/source target drift；
- Agent extraction audit 已提交且未报告 unresolved silent omission 或 contradiction。

失败必须返回 typed reason 和具体 claim / artifact / entry ids；不得以模糊
`invalid_artifact` 代替 coverage failure。修复后可以安全重试。

## Extraction rules

### Atomic decisions, not card-level laundering

一个 Question answer 可能同时包含字体家族、灰阶数量和“以 Figma variables 为准”等
多个事实；一个 component spec 也可能包含由不同来源支持的 anatomy、variant、radius
和 interaction。Agent 必须把这些内容拆成独立 claims。

一个 designer-edited card 只让它实际支持的 claim 具备
`formalized` 资格。它不能让同一 component spec 中所有无关字段自动 formalized。
如果一个 entry 聚合了多条规范性事实，而其中任一事实只有 candidate-level evidence，
该 entry 整体不得声明为 `formalized`。

Runtime 负责确定性校验 source ids、target existence、coverage 和 status eligibility，
不尝试用字符串匹配判断自然语言蕴含。语义相关性和矛盾检查由 Agent audit 与真实
Agent fixture 验证；Runtime 必须保存足够的 claim/excerpt/target lineage，让这些错误
可被审计。

### Richness by supported coverage

禁止用固定 token 数量作为通用完成门。Agent 应根据当前 evidence 覆盖以下适用类别；
某类别在输入中出现时，必须产出 entry 或显式 outcome：

- Color：primitive、semantic role、component usage；
- Typography：font family、font size、weight、line height、letter spacing、
  text transform 和 semantic text styles；
- Materials：spacing、size、ratio、radius、border、shadow、opacity；
- Motion / interaction：duration、easing、hover、active、focus、disabled、loading；
- Layout：canvas/container、grid、section rhythm、responsive relationships；
- Components：inventory、anatomy、variants、sizes、states、token links、boundaries、
  usage/content rules、responsive behavior、code links 和 open gaps；
- Principles / visual language：statement、scope、rationale、use / avoid 和 exceptions。
- Domain rules：领域级判断规则（如「不要用阴影做区域区分」「CTA 用 ink 色」），
  以 `kind: domain-rule` 写入所属领域的 source 文件并带正确 `domain`；
  不够全局的规则不得升级为 principle，也不得伪装成叙事 token。

只抽取 evidence 支持且对系统可复用的类别。不存在的产品状态或组件不是 gap。

### Rich 字段写作风格（soft contract）

以下规则适用于 layout 的 `relationship` / `responsiveBehavior` /
`acceptanceChecks`，interaction 的 `appliesTo` / `stateBehavior` / `motion` /
`layoutInvariants` / `accessibility` / `acceptanceChecks`，以及 component 的
`anatomy` / `variants` / `sizes` / `usageRules` / `contentRules` /
`responsiveBehavior` / `verificationTargets` / `openGaps`：

- 每条数组项只写一个短约束句：一句一条，禁止多句散文；
- 可结构化的空间和数值事实写入独立 key，或使用 `"96 → 56px"` 这类紧凑值，
  不埋进散文；
- 解读、理由和设计意图写入 `meaning`，且只写一句；
- 语言跟随设计师原文；设计师写中文，抽取规则也写中文；
- 禁止重述已有规则、禁止 padding、禁止超出 evidence 推广；无证据想法进入
  open questions，不进入 source rules。

Good / bad 对照（bad 同时违反一句一条、事实结构化、原文语言或证据边界）：

```json
{
  "layoutGood": {
    "value": {
      "gap": "20px",
      "imageSize": "461.25 × 446px",
      "responsiveBehavior": ["窄屏支持触控横向滚动。"],
      "acceptanceChecks": ["右侧裁切提示仍可见。"]
    },
    "meaning": "横向画廊用于连续浏览项目。"
  },
  "layoutBad": {
    "relationship": [
      "Project images form a horizontal track with 461.25 × 446px images and 20px gaps. The clipped edge creates a dynamic sense of discovery and should inspire future galleries."
    ]
  },
  "interactionGood": {
    "value": {
      "motion": ["悬停时箭头向右移动。"],
      "distance": "0 → 4px"
    },
    "meaning": "轻微位移用于确认链接可交互。"
  },
  "interactionBad": {
    "motion": [
      "The arrow glides elegantly to the right on hover. This delightful motion makes every action feel premium and engaging."
    ]
  },
  "componentGood": {
    "value": {
      "anatomy": ["CTA 由文字标签和右箭头组成。"],
      "contentRules": ["标签使用动词短语。"]
    },
    "meaning": "文字链接保持行动入口轻量。"
  },
  "componentBad": {
    "usageRules": [
      "Use this sophisticated CTA throughout the product wherever a strong action is needed. It should feel bold, polished, and memorable."
    ]
  }
}
```

这是 instruction / source contract 层的写作纪律，不新增自然语言 schema 硬校验；
`validateRulesFile` 继续只检查 rich 字段存在时是否为数组。

## JSON schema extensions

在保持 09A 文件布局和 entry envelope
`value / meaning / status / links` 兼容的前提下扩展 schema。

### Token entries

- 新生成的 token entry 必须携带显式 `domain`，至少支持
  `color | typography | spacing | size | ratio | radius | border | shadow |
  opacity | motion | breakpoint | other`。
- `domain: typography` 的 style token value 应能承载 font family、size、weight、
  line height、letter spacing 和 transform，而不是把完整 typography 压成一句
  `meaning`。
- Browser view model 优先使用 `domain` 投影 Color / Typography / Materials；
  旧 entry 的 name regex 仅作为向后兼容 fallback。

### Entry kind 与文件归属

- 所有 foundation entry（`token.json`、`layout-rules.json`、`interaction-rules.json`
  与 `design-system.json` 的 principles / visualLanguage）必须携带显式 `kind`：
  `token | domain-rule | global-rule`。
- kind 与文件归属必须一致，ingest 时确定性校验并给 typed reason：
  - `token`：只允许 `token.json`；
  - `domain-rule`：允许 `token.json` / `layout-rules.json` /
    `interaction-rules.json`；`token.json` 中的 domain-rule 必须携带 `domain`，
    指向所属 leaf（Color / Typography / Materials）；
  - `global-rule`：只允许 `design-system.json`。
- token 没有 global / domain 之分（scope 不是 token 的属性）；领域归属由
  `domain` 表达。不引入 `form` / `scope` 字段——Layout 的确定/概念区分维持
  字段级（facts vs meaning），不做 entry 级分组（09C-D04 锁定）。
- `kind` 必须经过 ingest、DB view 和 derived export 原样保留。
- 无 `kind` 的旧 entry 不要求迁移；Browser 对其维持现状渲染（09C-D04 的
  向后兼容默认）。

### Component specs

在现有 `description / props / boundaries / stateMatrix` 之外，为新生成 spec 增加：

- `anatomy`
- `variants`
- `sizes`
- `tokenLinks`
- `usageRules`
- `contentRules`
- `responsiveBehavior`
- `codeLinks`
- `verificationTargets`
- `openGaps`

适用字段必须有内容；不适用字段可以为空，但对应 manifest 必须说明是
not-applicable，而不是无声省略。额外字段必须在 ingest、DB view 和 derived export
中原样保留，不能因为 Browser v1 暂未渲染而丢失。

### Principles、layout 与 interaction

- Principle value 支持 `statement / rationale / scope / use / avoid / exceptions`。
- Layout rule 支持 relationship、responsive behavior、token links 和 acceptance checks。
- Interaction rule 支持 applies-to、state behavior、motion、layout invariants、accessibility
  和 acceptance checks。

## Browser boundary

本 issue 必须让现有 Browser 正确显示已生成的 Color / Typography / Materials token，
并用显式 token domain 替代新数据的关键词猜测。

新增 component detail 信息组、coverage summary、conflict warning 或 omitted-claim
入口属于新的具体 UI 范围。实现前必须向设计师取得 Figma 参考；没有 Figma 时只交付
data/API/derived-export 完整性和现有 Browser 信息架构内已经定义的内容，不得自行设计
新的 dashboard、banner、tab、popover 或编辑器。

## Acceptance criteria

- [x] `prepare_initial_design_system` 有专用、幂等的
      `claim_initial_design_system_preparation` tool。
- [x] Claim 返回 immutable Alignment snapshot 的 Description、Seed collection、
      evidence versions、Agent Annotations、Question answers、answer sources 和
      Designer Annotations。
- [x] Agent 可通过 `record_design_system_extraction_manifest` 提交 attempt-bound 原子
      claims、source excerpts、outcomes 和 entry targets。
- [x] Runtime 拒绝 unresolved input record、无目标 mapped claim、目标不存在、
      cross-attempt source id 和 target drift。
- [x] Runtime 要求每个非 gap source entry 被 claim 覆盖，但不使用固定 entry 数量作为
      richness 标准。
- [x] Runtime 不允许一个 designer-edited card 自动 formalize 聚合 entry 中无关或仅有
      candidate evidence 的事实。
- [x] `finalize_initial_design_system_preparation` 只有在 manifest、required artifacts、
      ingest、coverage 和 audit 全部通过后才完成 durable command。
- [x] 新生成 token 有显式 domain；Typography 不再依赖 token name regex 才能显示。
- [x] 新 entry 携带显式 `kind`（`token | domain-rule | global-rule`）；kind 与文件
      归属不一致的 artifact 被 ingest 拒绝并返回 typed reason。
- [x] 领域级判断规则以 `kind: domain-rule` 写入所属领域 source 文件并带正确
      `domain`，不再被丢弃或伪装为 token。
- [x] 含 `kind` 的 schema round-trip slice 在实现顺序上最先交付，解除 09C-D04
      e2e 的阻塞。
- [x] Typography value 可保留 family、size、weight、line-height、letter-spacing 和
      transform。
- [x] 新生成 component spec 保留 anatomy、variants、sizes、states、token links、
      boundaries、usage/content rules、responsive behavior、code links 和 open gaps。
- [x] 扩展字段经过 source → ingest → DB view → derived export 后不丢失。
- [x] Source 仍全部为 JSON，Browser 仍从 DB 读取，09A approval write-back 和 LWW
      event log 不回归。
- [x] Runtime 为 claim manifest recorded、coverage rejected、preparation finalized /
      failed 记录 canonical semantic events。
- [x] 测试覆盖断线重 claim、重复 manifest、artifact 重声明后的 target drift、缺文件、
      缺 component spec、遗漏 confirmed fact 和矛盾 audit。

## Real Agent validation

- [x] 使用 2026-07-29 真实项目的等价 fixture，真实 Agent 从完整 Alignment snapshot
      生成 Initial Design System。
- [x] `Instrument Sans` 或 fixture 中确认的实际 Figma 字体出现在 Typography token。
- [x] 16–105 字阶、标题负字距和六档灰阶分别映射到 source entry，或有经过审查的
      explicit outcome；不得静默遗漏。
- [x] “CTA 为标签 + 箭头文字链接、不使用填充按钮”的 answer 不得生成相反的
      filled Button contract。
- [x] 字体问题不得被用来单独支持无关 color / spacing entry 的 formalized 状态。
- [x] 重新抽取的项目中，领域级判断规则（如「不要用阴影做区域区分」）以
      `kind: domain-rule` 写入 `token.json` 并带正确 `domain`，不再静默丢失；
      Browser Rules 区（09C-D04）可见。
- [x] Workbench 现有 Typography leaf 能读取并显示真实 typography tokens。
- [x] 删除一个已确认 typography entry 后，finalize 返回具体 uncovered claim，而不是
      成功。
- [x] 把一个无关 edited card 链接到 formalized entry 后，Agent audit / fixture
      validation 失败，并保留可审计 lineage。
- [x] 对照 Skill Test 5 的适用信息类别核查 tokens、components、layout、interaction 和
      principles；不要求机械复制旧文件或固定条目数量。
- [x] 真实 smoke 与 deterministic MCP / fixture tests 分开记录。

## Likely difficulties for Agent

- 一张 answer 包含多个设计事实，Agent 可能仍按 card 粒度创建一个过大的 claim。
- Agent 可能为了达到 coverage 把输入全部标成 omitted，或制造没有产品意义的 gap。
- JSON pointer、entry id 与 artifact 重声明后的最新 DB version 可能漂移。
- Component entry 是聚合对象，字段级 evidence 与 entry 级 status 容易不一致。
- Runtime 不能确定性判断自然语言蕴含，不能假装 structural coverage 等于语义正确。
- 扩展 schema 后，旧 09A source、approval write-back、canonical serializer 和 derived
  export 需要保持兼容。
- Browser 当前按 token name regex 分类，迁移时可能导致旧 token leaf 改变。
- 新 component detail groups 没有 Figma 时不能自行设计 UI。

## Suggested ways through

- Claim id 使用 Agent 稳定 idempotency key；manifest replace-by-attempt，不做模糊 merge。
- Manifest target 使用 `artifact path + stable entry id + JSON pointer`，并在 ingest 后
  解析为当前 DB row；不要持久依赖 replace-by-source 后会变化的 row UUID。
- Finalize 先做纯 structural coverage，再读取 latest ingest version 检查 target drift。
- 对每个 input record 要求至少一个 outcome；对 `omitted` 设置枚举 reason category 和
  非空 explanation，方便发现滥用。
- Agent extraction audit 逐 claim 对照 source，再逐 source entry 反查 claim，完成双向
  检查。
- 用 golden semantic fixture 和 mutation tests 验证具体事实；不要让 Runtime 用 LLM
  或关键词匹配冒充语义裁判。
- Schema extension 先保证 round-trip preservation，再增加 UI consumption；含 `kind`
  的 schema slice 最先交付，解除 09C-D04 e2e 的阻塞。
- 新 token 使用 explicit domain；旧 token 保留 regex fallback，避免一次性迁移历史
  artifact。

## Out of scope

- 不在 09B 中实现 Seed reconstruction live preview；由 Issue 10 负责。
- 不在 09B 中把所有 candidate 自动提升为 formalized。
- 不恢复旧 Workflow Markdown 文件或 `design-reference-list.md`。
- 不新增复杂 Design System 手动编辑器。
- 不让 Runtime 调用模型判断设计语义真伪。
- 不自行设计缺少 Figma 参考的 Browser 新信息架构。

## Blocked by

- `07E-complete-initial-design-system-handoff.md`
- `08-source-artifact-declaration-validation.md`
- `09-draft-design-system-derived-view.md`
- `09A-design-system-browser-v1-form-and-source.md`

## Follow-on boundary

- Issue 10 使用 09B 的完整 Draft Design System 重建 Seed prototype，并记录
  prototype evidence。
- Prototype review 后的 designer correction 与正式规则更新继续进入 Issue 12 的
  proposal / Confirm / Cancel 边界。
- 若未来要求只有 prototype-validated entry 才能 `formalized`，应在 Issue 10 / 12
  的阶段契约中明确，不在 09B 内隐式改变 09A 的 approval 行为。

## Comments

### 2026-08-02 — Resolved with real-project evidence

09B 的 Runtime / MCP / schema / ingest / derived-view 实现由 `a2dc4f7` 首次完整
交付；后续提交补充了 rich-field 写作契约、composite typography role、显式
`kind` 与 domain-rule 文件归属。Issue 文件创建时遗留的 `needs-triage` 和未勾选
验收项此前没有随实现与验证同步更新，本次完成 closeout。

确定性验证与真实项目验证分开记录：

- 2026-08-02 重新执行直接相关的 preparation、schema、ingest、view-model 与 approval
  测试，共 5 个 test files、133 项测试全部通过。覆盖幂等 claim / manifest、冻结输入、
  incomplete input、target missing / drift、reverse entry coverage、kind / domain、component
  spec completeness、lineage、audit failure、真实语义 golden fixture 与 source → DB →
  derived export round-trip。
- 真实项目 `/Users/bingyizhang/Desktop/ikran test 7` 的 SQLite canonical record 显示，
  2026-07-30 已通过完整 09B 生命周期：Alignment attempt
  `35b9f4dc-708c-446d-bd92-3b025e0965f1`，command
  `2f8babe8-4d9d-44ae-87f9-f10964900aee`，manifest
  `5b0e3242-206c-4545-bdfe-d54d1283c707` version 1；manifest 含 52 个 atomic claims，
  audit 为 `passed`，finalize 记录 46 个 entries 并把 command 置为 `completed`。
- 该 manifest 明确保留 Instrument Sans、16–105 字阶、多档负字距、字体 weight /
  line-height、CTA「标签 + 箭头、不使用填充按钮」与 Color / Layout / Component /
  Interaction / Principle lineage。六档灰阶中已有证据的 black / white / `#767676`
  被 mapped，其余档位以显式 gap `primitive.color.grayScaleRemaining` 保存，没有静默补值。
- 2026-08-02 又基于同一真实项目的冻结 Alignment 证据完成一次真实重抽取和迁移：
  8 个 JSON artifacts 全部重新 declaration / ingest；当前 token source 含 31 个 token
  和 4 个 `domain-rule`。Color 有 2 条 Rules（次要灰用途、CTA ink），Typography 有
  1 条 Rules（大标题 `-3% → -5%`），Materials 有 1 条 Rules（不用阴影，以留白与
  分割线建立层级）。真实 Workbench Browser 已逐页核对 Rules / Tokens 分区；Materials
  在无 token 时只显示诚实的 Rules 区。
- 这次重抽取首次声明 `token.json` 时，两个仅由“设计师接受 Agent 提议”支持的规则被
  错标为 `formalized`，Runtime 返回 typed failure
  `formalized_requires_designer_edited_link`；按证据等级降为 `candidate` 后唯一一次重试
  成功，Token declaration version 为 5，quality diagnostics 为空。

本次重抽取调用 `claim_initial_design_system_preparation` 返回
`no_pending_initial_design_system_command`，原因是上述真实 command 已于 2026-07-30
完成；因此没有伪造第二次 manifest / finalize。完整 claim → manifest → finalize 的
真实证据取自 canonical DB 中已完成的 2026-07-30 记录；2026-08-02 记录只证明后续
真实 evidence-driven authoring、typed declaration gate、ingest round-trip 与 Browser
呈现。两类证据边界保持明确。
