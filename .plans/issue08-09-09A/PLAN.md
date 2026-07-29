# PLAN — Issue 08 / 09 / 09A 总指挥拆分

日期: 2026-07-29。指挥: 主 Agent; 执行: 子 Agent; 每任务周期: 实现 → 独立验收 → /code-review → 单独提交。

规格源(不要再开决策讨论):
- `Issues 02/08-source-artifact-declaration-validation.md`
- `Issues 02/09-draft-design-system-derived-view.md`
- `Issues 02/09A-design-system-browser-v1-form-and-source.md`(9 条已锁定设计决策)
- PRD `IKRAN-MVP-PRD.zh-CN.md`(已按 09A 修订)
- UI 依据: `app/prototypes/ds-section-nav/` v3 Section Tabs(设计师确认) + emil-design-eng 准则;09A UI 开工后删除该原型 surface。

## 架构事实(来自代码探索,2026-07-29)

- MCP 工具注册: `lib/mcp/register-tools.ts` → 每域一个 `*-tools.ts`;zod 传输 schema 在 `lib/runtime/commands/schemas.ts`(只做结构校验);域校验在 `lib/runtime/*.ts` 返回 `{ ok:false, reason }`。
- 事件: `lib/runtime/events.ts` `EventType` union;`logEventOnDb` 在事务内;`draft_design_system_generated` / `design_system_view_generated` 已声明未使用;需新增 `invalid_artifact` 等。
- DB: `lib/runtime/db.ts`(node:sqlite, 每调用新连接, `withProjectTransaction`);迁移 `lib/runtime/migrations.ts` CURRENT=14,新增表走 v15+。
- 路径 scope 校验复用: `lib/runtime/evidence-package.ts` `assertArtifactPathInProject` / `resolveProjectArtifactPath`。
- 最近类比实现: `recordEvidencePackage`(纯 validator → scope 校验 → 事务 insert + logEventOnDb → commit 后 emitRecordEvent)。
- Alignment 交叉校验数据源: `alignment_question_cards.answer_source`("designer-edited" / "agent-proposed-designer-accepted");`agent_alignment_annotations.inference`("confirmed"|"reasonable");designer annotations 走 `getDesignIntentAlignment` 快照 `designer_annotations`。
- Workbench: `SeedEvidenceWorkbench.tsx` + `alignment-stage-panel.tsx`(六步面板,Complete tray);"Draft Design System" 按钮挂这里;数据经 SSE `/api/events` + `runtime-client.ts`;新 record-bus kind 扩 `lib/runtime/record-bus.ts:9`。
- 测试: vitest `tests/unit/`(temp project 模式);MCP 边界 e2e 用 `tests/helpers/mcp.ts`;`npm run check` = typecheck + unit + e2e。
- 无 artifact index、无 design-system 任何代码、无 research export — 全部新建。

## 任务拆分(依赖序)

### Task A (Issue 08) — `record_artifact_written` + artifact index + 三类校验框架
- 迁移 v15: `source_artifacts` 表(id, path, artifact_type, semantic_purpose, related_record_ids_json, status, declared_at 等,遵循现有命名/索引约定)。
- 新域模块 `lib/runtime/source-artifact.ts`: 纯 validator + `recordSourceArtifact`(scope 校验 → 事务 insert + 事件);三类校验: semantic record schema / design-system artifact(结构存在性,深度 schema 属 Task B)/ code artifact(存在性 + scope + 可选 readiness,不评代码质量)。
- 事件: `source_artifact_declared`、`invalid_artifact`(加入 EventType union);声明失败最多请求一次修复,不补造语义。
- MCP registrar `lib/mcp/artifact-tools.ts` + zod schema + `IKRAN_MCP_INSTRUCTIONS` 追加契约("写完 source artifact 后立即声明")。
- 未声明文件 guard: artifact index 查询 API(供未来 research export 过滤);本任务只建机制。
- 测试: `tests/unit/source-artifact.test.ts`(有效声明、越界路径、未知类型、校验失败、guard)。

### Task B (Issue 09 主体) — design-system JSON schema + 状态三档交叉校验 + token alias 图
- `design-system/` 全 JSON 源布局: `design-system.json`、`token.json`(三层 primitive→semantic→component)、`component-list.json`、`components/<name>.json`、`layout-rules.json`、`interaction-rules.json`。
- 手写校验器(项目惯例,非 zod)返回 reason 字符串;声明需关联 answered question card ids。
- 状态三档交叉校验: formalized 必须 link `answer_source=designer-edited` 已答卡;candidate 需 link 已答卡或 `inference=reasonable` annotation;gap 只能显式声明。Agent 冒充被硬挡。
- token alias 引用图: 拓扑排序 + cycle 检测。
- 测试: schema 校验、交叉校验拒绝/降级、cycle 检测。

### Task C (Issue 09 + 09A) — DB ingest + Browser 读 API + derived export
- ingest: 文件 → 08 声明 → B 校验 → 入 DB(新迁移 v16 design-system 表)。
- Browser 读 API `app/api/design-system*/route.ts`: DB 实时 join 证据链(answered card / annotation / evidence version / designer annotations),Workbench 不读 view.json。
- `design-system-view.json` 作为 derived export 写 `.ikran/artifacts/`;emit `draft_design_system_generated` / `design_system_view_generated`。
- record-bus 新增 kind 驱动 Browser 刷新。
- 测试: ingest 成功/失败、API join 正确性、export 生成。

### Task D (Issue 09A) — candidate → formalized 审批写回
- Browser 内唯一写操作:审批同时写 DB 并回写对应 JSON 源文件。
- canonical JSON serializer(固定 key 序、2 空格缩进、末尾换行),diff 无噪声。
- LWW + 语义事件记录;冲突留 event log。
- 测试: DB 与文件一致性、canonical 序列化稳定性、事件记录。

### Task E (Issue 09A) — Browser UI(底部 sheet + Section Tabs)
- 六步完成后左侧面板底部 "Draft Design System" 按钮;底部 sheet 升起(scrim/Esc/关闭钮;Esc 不穿透 tldraw 画布,独立 focus trap)。
- Section Tabs: Foundations(Home/Color/Typography/Materials/Layout/Interaction) + Components(Home/详情含 Boundaries 与状态矩阵);无独立 Rules 页面;无 section 折叠。
- 行内只显示 值/含义/状态 chip;证据链收进 ⓘ hover 浮层。
- 审批 UI 接 Task D 写 API。
- 视觉: 以 `app/prototypes/ds-section-nav/` v3 为基础,遵循 emil-design-eng 准则;开工时删除该原型 surface。
- 测试: sheet 入口时机、Esc 隔离、渲染叶子与详情。

### Task F — 集成 + MCP/e2e 边界 + 真实 Agent 验证
- MCP 边界 spec(`tests/helpers/mcp.ts`): record_artifact_written 全流程。
- e2e: 声明 → ingest → Browser 渲染 → 审批写回链路。
- 真实 Agent validation(08/09/09A 各自 Real Agent validation 清单),记录 open gaps。

## 每任务周期(用户指令)

1. coder 子 Agent 实现(带完整上下文 brief;TDD seam: 校验器/交叉校验/写回先写测试)。
2. 独立验收子 Agent:对照 issue acceptance criteria + 跑相关测试,出验收报告。
3. /code-review(Standards + Spec 两轴);发现问题由 coder 修。
4. 主 Agent 单独提交该任务(git commit;用户已授权本流程的 commit 与最终 push)。
5. 全部完成后: `npm run check` 全绿 → push GitHub → WebBridge 真实 Inspect Workbench。
