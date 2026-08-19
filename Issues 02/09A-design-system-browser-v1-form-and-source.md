# Design System Browser v1 形态与全 JSON 源

## What to build

在 09 的 derived view 能力之上，落实 Design System Browser 的具体产品形态：全 JSON source 层、DB 为运行时真源、三档状态交叉校验、Section Tabs 导航、底部 sheet 入口。本 issue 细化 09 的 UI 形态与源格式；09 仍是 source 声明、校验与 derived view 生成的主力 issue。

视觉参照 prototype `app/prototypes/ds-section-nav` v3(Section Tabs 导航,经设计师确认);本 issue 开工后删除该原型表面。具体 UI 仍以 Figma 为准——开工前先问设计师要 Browser 的 Figma 参考,不要拿原型当最终实现稿。

### 设计决策(2026-07-29 与设计师逐条确认)

1. **全 JSON 源层,无 Markdown 岛**:design-system source artifacts 全部是 JSON 文件;长文叙述(如 visual language 描述)作为 JSON 字符串字段承载,不保留独立 `.md` 源文件。旧 Skill 时代的 `design-reference-list.md` 取消,不迁移。
2. **DB 为运行时真源**:链路为 文件 → 08 声明 → schema 校验 → ingest 入 DB → Browser 读 API。证据链(规则 ↔ answered card / annotation / evidence version)由 Runtime 在读取时实时 join,不预先烘焙进视图文件。`design-system-view.json` 降级为 `.ikran/artifacts/` 下的 derived export(供研究导出与外部消费),Browser **不读它**。
3. **文件按职责分**:源文件放项目根 `design-system/`——`design-system.json`(元信息 + concepts + visual language 叙述)、`token.json`(单文件三层:primitive → semantic → component,跨域 alias 网不拆到多文件)、`component-list.json`、`components/<name>.json`(每个组件一个文件)、`layout-rules.json`、`interaction-rules.json`。
4. **状态三档 = 声明 + 交叉校验**:`formalized` / `candidate` / `gap` 不由 Agent 自报生效,Runtime ingest 时交叉校验——formalized 必须 link 到 `answer_source=designer-edited` 的已答卡;candidate 需 link 已答卡或 `inference=reasonable` 的 Agent annotation;gap 免 link(标注缺口本身就是语义)。注意:07 Complete 门要求所有卡有 final answer,因此 gap 只能由 Agent 显式声明,不能从"未答卡"推导——不存在未答卡。
5. **v1 编辑只开放状态审批**:Browser 内唯一写操作是 candidate → formalized 审批,同时写 DB 并回写对应 JSON 源文件。其余编辑(改值、改叙述)不在 v1。
6. **行内只展示 DS 信息本体**:每行显示值 / 含义 / 状态 chip;全部证据与溯源链(answered card、annotation、evidence version、designer annotations)收进 ⓘ hover 浮层,不在行内展开。
7. **无 section 级折叠**:tabs 下叶子平铺,不做顶层文件夹式收纳;将来叶子爆炸时在 tab 内分组,不在 v1。
8. **写回冲突 LWW + event log**:审批写回采用 last-write-wins 并记录语义事件;etag/版本向量留到多人时代,不在 v1。
9. **入口形态**:六步 extraction 全部完成后,左侧面板底部出现 "Draft Design System" 按钮;点击后 Browser 以**底部 sheet** 升起,覆盖屏幕大部分、顶部留出 Workbench 空隙。sheet 建议模态:scrim 点击 / Esc / 关闭按钮关闭。

### 六部分抽取 → Browser 映射

- Design Concept → Foundations Home 的规则卡(concepts 放全局 Home,不独占叶子)。
- Visual language → Foundations Home 叙述区 + token 行的 meaning 字段。
- Token → Color / Typography / Materials 三个叶子(token.json 三层投影)。
- Layout → Layout 叶子规则行。
- Interaction → Interaction 叶子 + 组件状态矩阵。
- Component → Components 清单 + 详情页(含 Boundaries)。
- Designer annotations(08A)→ 打入抽取输入快照;在 Browser 中作为 ⓘ 浮层内的设计师批注呈现,不单独成行。

### 导航结构(Section Tabs,prototype v3)

- 顶部两个 tab:**Foundations** / **Components**,各自有 Home page。
- Foundations:Home(concepts 规则卡 + visual language 叙述)、Color、Typography、Materials、Layout、Interaction。
- Components:Home(inventory 总览)、各 component 详情(含 Boundaries 与状态矩阵)。

## User stories covered

- 23, 24, 25, 26, 27, 28, 29, 30, 31, 32(与 09 相同;本 issue 细化其 UI 形态与源格式)

## Acceptance criteria

- [x] design-system source 全部为 JSON;无 Markdown 源文件、`design-reference-list.md` 不存在。
- [x] 源文件布局为 `design-system/` 下 `design-system.json`、`token.json`、`component-list.json`、`components/<name>.json`、`layout-rules.json`、`interaction-rules.json`。
- [x] Runtime 校验并 ingest 入 DB;Browser 数据经 API 从 DB 实时 join(含证据链),渲染不依赖 `design-system-view.json`。
- [x] `design-system-view.json` 作为 derived export 写入 `.ikran/artifacts/`。
- [x] 状态三档由 Runtime 交叉校验计算:无 designer-edited link 的 formalized 声明被拒绝/降级;gap 只能显式声明。
- [x] 行内只显示值/含义/状态 chip;ⓘ hover 浮层展示完整证据与溯源链(含 designer annotations)。
- [x] candidate → formalized 审批同时写 DB 与回写 JSON 源文件,并记录语义事件。
- [x] 写回冲突按 LWW 处理并留 event log。
- [x] 六步完成后左侧面板底部出现 "Draft Design System" 按钮;Browser 以底部 sheet 升起,scrim/Esc/关闭钮可关闭。
- [x] 六部分映射全部落地:concepts 在 Foundations Home,组件详情含 Boundaries,无独立 Rules 页面。
- [x] 测试覆盖:JSON schema 校验、状态交叉校验、审批写回(DB + 文件一致)、导出物生成、sheet 入口出现时机。

## Real Agent validation

- [x] 真实 Agent 完成六步 alignment 后,左侧面板出现 "Draft Design System" 按钮;打开 sheet 渲染至少一个 foundation 叶子和一个 component 详情。
- [x] 设计师在 Browser 内审批一条 candidate → formalized;SQLite 与对应 JSON 源文件同步更新,语义事件可查。
- [x] Agent 声明一个无 designer-edited link 的 formalized 规则,被 Runtime 交叉校验拒绝或降级为 candidate。

### 验证记录(2026-07-29,真实项目 `~/Desktop/ikran test 7`,schema v16)

- 六步 alignment 完成(18/18 卡全部作答,含 2 张 designer-edited)后,顶部 Extraction 面板出现 "Draft Design System" 按钮(注:实际入口在 extraction 面板底部,非本文件所述"左侧面板");点击后 88vh 底部 sheet 升起,Section Tabs(Foundations/Components)+ ⓘ 证据浮层(QUESTION CARDS / EVIDENCE VERSIONS / DESIGNER ANNOTATIONS)渲染正确,Esc 可关闭。
- 审批正例:token `primitive.space.unit`(candidate,links 含 designer-edited 卡 96fb147d)在 sheet 内点 "Approve → formalized" → UI chip 即时翻转;`design-system/token.json` 写回 `"status": "formalized"`(canonical 序列化),SQLite `design_system_entries` 同步,事件 `design_system_entry_approved` ×1(payload: from candidate → to formalized)。
- 审批负例(UI):Project Card(candidate,仅 accepted 卡支撑)审批被拒,inline 显示 "Approval failed: Needs a designer-edited answered card before it can be formalized.",chip 保持 candidate。
- 声明负例(MCP):formalized 但无 designer-edited link 的 component-spec 在声明事务内被硬挡(`formalized_requires_designer_edited_link`),记 `invalid_artifact` 事件,不入 artifact index。

## Likely difficulties for Agent

- Agent 可能把 candidate 冒充 formalized,或把 link 伪造到非 designer-edited 的卡上——交叉校验必须在 ingest 时硬挡。
- `token.json` 三层 alias 网(primitive → semantic → component)的 schema 校验与 cycle 检测容易漏。
- 审批写回 JSON 需要稳定格式化(canonical 序列化),否则设计师看到无意义 diff 噪声。
- 底部 sheet 与 tldraw 画布的 Esc/焦点路由冲突;sheet 打开期间画布快捷键要隔离。

## Suggested ways through

- 状态永远由 Runtime 计算,Agent 只能声明候选;交叉校验在 ingest 时做,失败原样拒绝并返回原因。
- token 校验时构建 alias 引用图,做拓扑排序与 cycle 检查后再入库。
- 写回使用 canonical JSON serializer(固定 key 序、2 空格缩进、末尾换行),diff 只反映真实语义变化。
- sheet 用独立 focus trap;Esc 先关 sheet,不穿透到画布。

## Blocked by

- `08-source-artifact-declaration-validation.md`
- `09-draft-design-system-derived-view.md`(本 issue 细化其 UI 形态与源格式;09 仍是 source 声明、校验与 derived view 生成的主力)

## Notes(2026-07-29)

- PRD 已同步修订(2026-07-29,经设计师确认):story 30(全 JSON 源)、story 31(DB 实时读取,view.json 降级为 derived export)、:349(source artifact 例子)、:376(token.json 路径改为 `design-system/token.json`)、:398(初始 source 文件集)、:399(view.json 用途)。
- Designer annotations(08A)是抽取输入快照的一部分,在 Browser 中经 ⓘ 浮层呈现;不要为它们在 Browser 里建独立列表页。
