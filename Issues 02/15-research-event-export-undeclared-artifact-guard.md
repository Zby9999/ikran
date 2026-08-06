# Research Event Export 与 Undeclared Artifact Guard

Status: implemented（MCP export；Workbench action UI 推迟；Evidence/Annotation 独立文件与 Seed lineage 深化可后续补）

> **修订记录(2026-08-06)**:导出物新增 `designer-feedback.json`(Issue 27 的原始反馈日志,含未被审查提升的记录,proposal 引用其中子集);入选门槛中的 "Design System v1" 以 Issue 28 的 `formalize_design_system` 相位事件为准;`Blocked by` 中的 10/12 替换为 27/28/29/30。其余不变。

## What to build

提供 MVP research export：Runtime 将语义事件、canvas records、artifact index、Question card、designer answers、prototype runs、rule update proposals 导出到 `.ikran/export/`。导出必须保留 record linkage，并明确排除未声明 source artifacts。

**入选门槛 vs 导出内容（勿混淆）：**

- **入选门槛：** 仅完整走完成功递归的项目**有资格**生成研究 export。门槛：Design System v1 → 新原型 → 反馈 / 确认规则更新 → Design System v2 → 第二次新设计。未达门槛的项目不生成研究 export。
- **导出内容：** 一旦有资格，export 必须包含该项目从 seed 到第二次新设计的**整条成功语义链路**（含闭环完成前的阶段：seed、evidence、annotation、alignment、DS v1、第一次原型等），不是只导出终点。
- **过程中照常记录：** Runtime 在闭环完成前就持续写入成功语义事实；门槛只约束「何时可宣称研究 export」，不表示闭环前没有研究痕迹。

此 slice 不只是导出 mock workflow；它必须包含至少一次真实 Agent 已声明 artifact/run/proposal 的 export 验证。本 issue 同步目标与验收；**不声称已实现完成**。

### 2026-07-10 后续架构收口

研究 export **入选**要求完整成功递归；**内容**为整条成功链路（含闭环前成功阶段）。排除：失败请求、失败标注、草稿、取消、Open Gap、canvas layout、未声明 source artifact。运维调试仍可保留失败日志；它们不是研究事实。SQLite events canonical；导出中的 JSONL 为 derived。成功语义记录与 Agent annotation raw region 可回放。详见 PRD 与 ADR 0002。

### 2026-07-12 Figma capture provenance

成功研究链路必须记录 Seed Reference initiator、successful positional-evidence capture、evidence lineage/versions 与 Agent-confirmed primary node linkage。PAT、Keychain metadata、失败 capture、403/404/429 和未成功提交的 link 不进入 research export。详见 PRD 与 ADR 0003。

## User stories covered

- 46, 47, 48, 49, 50

## Acceptance criteria

- [x] Export 生成 `.ikran/export/`。
- [x] 仅完整成功递归项目（DS v1 → 新原型 → 反馈/确认规则更新 → DS v2 → 第二次新设计）**有资格**生成研究 export；未达门槛拒绝/跳过。
- [x] 达标后的 export 包含整条成功语义链路（含闭环完成前的 seed / evidence / annotation / alignment / DS v1 / 第一次原型等），不是只导出终点。
- [x] 最小导出包含 `events.jsonl`、`project-summary.json`、`alignment-questions.json`、`designer-answers.json`、`prototype-runs.json`、`rule-update-proposals.json`、`designer-feedback.json`、`artifacts-index.json`。`designer-feedback.json` 为原始反馈日志（含未被审查提升的记录），rule update proposals 引用其中子集作为 evidence。
- [ ] Export 保留 Evidence Surface、Region Annotation、Question card、answer、prototype run、rule proposal、artifact 的 linkage；成功 annotation raw semantic region 可回放。
- [ ] Export 保留每个 Seed Reference 的 canonical identity、initiator、successful capture、evidence lineage/current version 与 confirmed primary node linkage，但不包含 PAT 或可恢复凭证的信息。
- [ ] 低层 pan/zoom/hover/keystroke 与 canvas layout 不作为 research events 导出。
- [x] 未声明 source artifact 不进入 artifact index 或 export。
- [x] 失败请求、失败标注、草稿、取消、Open Gap 不进入研究事实导出（可另有运维/调试记录，但不冒充研究成功语义）。
- [ ] 失败 Figma capture、未提交 link、连接错误和限流不进入成功研究事实导出。
- [ ] Workbench 提供最小 export action 和 completion status。
- [x] 测试覆盖：达标项目导出含早期成功阶段；未达门槛拒绝/跳过；真实 Agent 声明 artifact export；未声明 artifact guard。

## Real Agent validation

- [ ] 使用至少一次真实 Agent 声明过的 source artifact、preview 或 proposal，在完整成功递归项目上生成 export。
- [ ] 手动检查 export 含真实声明链路与闭环前成功阶段，且不包含未声明文件、失败/草稿/取消/Open Gap/canvas layout。

## Likely difficulties for Agent

- 把「入选门槛」误读成「闭环前痕迹无研究价值 / 不导出早期阶段」。
- Export 容易只 dump 当前数据库，而忽略跨 record linkage 与成功门槛。
- 未声明文件可能存在于项目中，Agent 可能期望它出现在 export。
- 真实 Agent smoke 产生的 open gaps 需要可调试，但不能混入成功研究 export。

## Suggested ways through

- Export 从 artifact index 和 canonical SQLite events 生成 derived JSONL，而不是扫描项目文件夹。
- 先检查成功递归入选门槛；通过后再导出该项目全部成功语义事件与 linkage（含早期阶段）。
- 未声明文件与 Open Gap 只进入**独立的运维/调试输出**；不得进入 research export 的任何文件，包括 summary、index 或 derived JSONL。
- 明确区分研究 export 与运维调试日志。

## Blocked by

- `07-design-intent-alignment-six-part-gate.md`
- `05D-retire-agent-evidence-real-smoke.md`
- `08-source-artifact-declaration-validation.md`
- `27-chat-first-designer-feedback-declaration.md`
- `28-phase-state-machine-design-system-formalization.md`
- `29-batch-rule-update-review.md`
- `30-prototype-surfaces-multi-embed-single-live.md`
- `13-human-intent-new-prototype-loop.md`
