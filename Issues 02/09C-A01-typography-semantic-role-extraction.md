# Typography 语义角色抽取与 Type Atlas 去重

Status: resolved

## Parent

- `09C-A-design-system-reader-projection-resizable-split.md`

## What to build

让新一轮 Draft Design System 抽取把 Typography 组织成完整、可阅读、可追溯的语义
角色，而不是由零散 atomic size token 在 Browser 中临时冒充字体样式。

每个进入 `Type styles` 的 typography role 必须由一个 semantic/component token 表达，
并保留已有 canonical typography facts 的引用关系。Role value 必须包含一个 scalar
font size，并按证据包含适用的 family、weight、line-height、letter-spacing 和
transform；缺失的构造事实继续保持缺失，不推测、不补全。Role identity 负责稳定命名，
`usedFor` 描述使用位置、功能或设计意图，不再承担数值属性命名。

抽取契约向 Agent 明确 typography role 的目标形态，只提供 canonical role identity
的好坏示例，不提供可能被照抄并扩散到其他 Draft owner 的英文说明句。抽取质量检查对
“meaning 复述 role 名称”“只增加 size / role / token 等属性词”以及“存在充足字体
事实却没有形成 role”等情况返回可操作的诊断。普通 Source Artifact 路径的质量诊断
保持非阻断；Initial Design System semantic commit 则对 font-size role 覆盖率执行
阻断校验。字体角色用途允许在 Draft 中预填最合理的语义，但候选生命周期状态由 Runtime
单独管理，不进入 role 名称或 `usedFor`；不得补造未经观察的构造属性。

Type Atlas 的 `Type styles` 只读取 semantic/component roles，以 role identity 生成
左侧名称、以 `usedFor` 生成右侧 `Used for`。Projection 不再从 usage 文本反向派生名称。Atomic
family、size、weight、line-height、letter-spacing 和 transform 仍留在 canonical
source、DB view、alias graph 与 evidence lineage 中，但不再单独生成 `Type styles`
条目。

当前仍处测试阶段：不增加历史 Draft Design System 的兼容、迁移或降级展示分支。
实现完成后删除测试项目已有 Draft Design System，通过真实 Agent 重新抽取，以新产物
直接验证实际效果。

### 2026-08-29 — Seed 字号完整覆盖策略

真实 fast-path 测试证明“只有用途明确时才建立 typography role”会稳定漏掉已经在
Seed 证据中识别出的字号：primitive 与规则正文保留了完整字号集合，但 Type styles
只能看到少数已映射角色。新策略把每个不同的 Seed / Alignment 字号视为必须覆盖的
Typography 构造事实：每个字号除 atomic primitive 外，还必须各自建立一个
semantic/component role。字体用途尚未确定时，Agent 依据可见层级预填最合理的 role
名称和 `usedFor`，由设计师在 Draft 审阅时纠正；不得因语义不确定而省略字号，也不得
把多个字号合并为一个 scale role。

这是字体角色特殊性的限定规则，不改变 Color、Material、Layout、Interaction 或
Component 的证据门槛，也不允许这些领域预填未经支持的语义。Runtime 只对
`domain: typography` 的 `fontSize` primitive 执行覆盖检查；普通 semantic commit 与
增量 fast path 缺少任一字号角色时都会阻止进入 Draft，并返回缺失字号列表。Type
Atlas 继续只展示角色，不增加 primitive fallback。

## Acceptance criteria

- [x] 初始 Design System preparation contract 明确要求新抽取的 typography role 使用
      semantic/component token，并区分稳定 role identity、`usedFor` 与数值构成。
- [x] Contract 提供 canonical typography role identity 的正反例，但不提供可能被
      Agent 照抄为 `usedFor` 或其他 Draft 文案的英文说明句。
- [x] 当 typography `meaning` 近似复述 role 名称，或只添加 `size`、`role`、`token`
      等属性词时，质量检查返回可定位到具体 entry 的非阻断诊断。
- [x] 当证据不足以确认使用场景或完整字体属性时，诊断允许保留明确缺口，不要求 Agent
      编造 meaning、weight、line-height、tracking 或 transform。
- [x] `Type styles` 只包含具有 typography style 字段的 semantic/component roles；atomic
      typography tokens 不再单独生成 Atlas style 行。
- [x] Atlas 左侧名称来自 role identity，右侧 `Used for` 来自 `meaning`；Projection
      不再通过裁剪 `meaning` 生成名称。
- [x] Composite role 展开后只显示其自身或 alias graph 可解析到的 family、size、
      weight、line-height、letter-spacing 与 transform，保持 source identity、状态和
      evidence lineage 可追溯。
- [x] 每个不同的 evidence-backed Typography `fontSize` primitive 都有一个独立、
      可见的 semantic/component role；精确字体用途未知时允许预填最合理的语义，
      candidate 生命周期状态不进入可见文案。
- [x] 普通 semantic commit 与增量 fast path 在提交前阻断缺少字号角色的 Draft，并
      返回全部缺失字号；literal 与 primitive alias 两种写法都能正确计入覆盖。
- [x] 字号覆盖和字体角色语义预填仅限 Typography，不改变其他 Design System owner 的
      抽取与证据边界。
- [x] 自动测试覆盖 preparation contract、非阻断诊断、Reader Projection、Atlas
      渲染与 atomic token 不进入 `Type styles` 的行为。
- [x] 删除 `ikran test 7` 的旧 Draft Design System 后，真实 Agent 能重新抽取出完整
      typography roles；真实 Browser 验证名称与 `Used for` 不再互相复述，且已确认的
     字体属性可在对应 role 中读取。
- [x] 不引入历史数据迁移、兼容或旧 atomic-size Atlas fallback。

## Blocked by

- None — can start immediately.

## Comments

### 2026-08-02 — Implemented and verified

- 新增 composite typography role 写作契约、正反例和非阻断 `quality_diagnostics`；
  declaration / ingest 在诊断存在时仍成功。
- 质量诊断排除 primitive meanings 与 `gap` construction facts，并限制 composite role
  只能来自 semantic / component layer。
- Type Atlas 只投影 composite roles；atomic-only 数据显示“尚无 composite roles”的
  精确空态，不再生成伪 Type style。
- `ikran test 7/design-system/token.json` 的旧 Typography 抽取已整体替换，原文件保存为
  `token.json.pre-09c-a01.bak`；重新声明成功、状态为 `ingested`、诊断为空。
- 真实 Browser 显示 8 个 Type styles；role identity 与 `Used for` 不再复述。
- 直接相关验证：110 个单测通过；
  `tests/design-system-reader.spec.ts` 通过；真实项目 Browser 验收通过。
- 全量检查中 871/871 单测、79/80 浏览器用例通过；唯一失败是既有
  `tests/design-system-browser.spec.ts` 的 Radix evidence popover 拦截 `Color` heading
  hover，单独重跑仍在同一未修改路径超时，与本 Ticket 的 Typography diff 无关。
