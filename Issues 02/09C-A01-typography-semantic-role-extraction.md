# Typography 语义角色抽取与 Type Atlas 去重

Status: resolved

## Parent

- `09C-A-design-system-reader-projection-resizable-split.md`

## What to build

让新一轮 Draft Design System 抽取把 Typography 组织成完整、可阅读、可追溯的语义
角色，而不是由零散 atomic size token 在 Browser 中临时冒充字体样式。

每个进入 `Type styles` 的 typography role 必须由一个 composite token 表达，并保留
已有 canonical typography facts 的引用关系。Composite value 应按证据包含适用的
family、size、weight、line-height、letter-spacing 和 transform；缺失事实继续保持
缺失，不推测、不补全。Role identity 负责稳定命名，`meaning` 只描述使用位置、功能或
设计意图，不再承担数值属性命名。

抽取契约向 Agent 明确 typography role 的目标形态，并提供好坏示例。抽取质量检查对
“meaning 复述 role 名称”“只增加 size / role / token 等属性词”以及“存在充足字体
事实却没有形成 composite role”等情况返回可操作的非阻断诊断；诊断不得使 source
artifact declaration、ingest 或 finalize 失败，也不得要求 Agent 在无证据时编造用途。

Type Atlas 的 `Type styles` 只读取完整 composite roles，以 role identity 生成左侧名称、
以 `meaning` 生成右侧 `Used for`。Projection 不再从 `meaning` 反向派生名称。Atomic
family、size、weight、line-height、letter-spacing 和 transform 仍留在 canonical
source、DB view、alias graph 与 evidence lineage 中，但不再单独生成 `Type styles`
条目。

当前仍处测试阶段：不增加历史 Draft Design System 的兼容、迁移或降级展示分支。
实现完成后删除测试项目已有 Draft Design System，通过真实 Agent 重新抽取，以新产物
直接验证实际效果。

## Acceptance criteria

- [x] 初始 Design System preparation contract 明确要求新抽取的 typography role 使用
      composite token，并区分稳定 role identity、usage `meaning` 与数值构成。
- [x] Contract 提供至少一个完整 typography role 的正例，以及将 atomic size 的
      `meaning` 写成 `X size role` 的反例。
- [x] 当 typography `meaning` 近似复述 role 名称，或只添加 `size`、`role`、`token`
      等属性词时，质量检查返回可定位到具体 entry 的非阻断诊断。
- [x] 当证据不足以确认使用场景或完整字体属性时，诊断允许保留明确缺口，不要求 Agent
      编造 meaning、weight、line-height、tracking 或 transform。
- [x] `Type styles` 只包含具有 typography style 字段的 composite roles；atomic
      typography tokens 不再单独生成 Atlas style 行。
- [x] Atlas 左侧名称来自 role identity，右侧 `Used for` 来自 `meaning`；Projection
      不再通过裁剪 `meaning` 生成名称。
- [x] Composite role 展开后只显示其自身或 alias graph 可解析到的 family、size、
      weight、line-height、letter-spacing 与 transform，保持 source identity、状态和
      evidence lineage 可追溯。
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
- 真实 Browser 显示 8 个 Type styles，例如 `typography.connectHeading` 对应
  `Closing-section call to action.`，名称与 `Used for` 不再复述。
- 直接相关验证：110 个单测通过；
  `tests/design-system-reader.spec.ts` 通过；真实项目 Browser 验收通过。
- 全量检查中 871/871 单测、79/80 浏览器用例通过；唯一失败是既有
  `tests/design-system-browser.spec.ts` 的 Radix evidence popover 拦截 `Color` heading
  hover，单独重跑仍在同一未修改路径超时，与本 Ticket 的 Typography diff 无关。
