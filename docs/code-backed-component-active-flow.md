# Code-backed Component Active Flow

Ikran 的 Active 组件工作流不依赖 Storybook，也不要求 Agent 为每个组件编写 Story、独立 harness route 或额外的状态页面。

## Agent contract

Agent 写完组件源文件后，只需调用一次 `record_artifact_written`，并在 `componentPreview` 中提供当前 Prototype 的精确身份：

- `runId`、ready `surfaceId` 与 Design System `entryId`
- 与 artifact `path` 完全相同的 `modulePath`
- 精确的 `exportName`
- 可 JSON 序列化的 `defaultArgs` 和可选 `stateArgs`
- `semanticImpact`：Agent 对照当前 component contract 后明确填 `none` 或 `possible`；判断依据可通过 `semanticEvidenceRecordIds` 固定到证据记录
- 只有组件确实依赖 provider/fixture 时才声明 `providerRecipe`

Runtime 随后自动完成：精确 code link、共享 Preview 注册、默认态 live hero、内容寻址验证身份、default-first 验证、后台状态验证、缓存与断点续跑，以及内部 `Verified Candidate` 事件。内部候选事件不会自动改变 Design System entry 的 `candidate`/`formalized` 状态；正式化仍受既有 designer review 和 `formalize_design_system` 门禁约束。

## Agent judgment boundary

普通、经 Agent 明确判定且 Runtime 用前后 contract digest 复核为语义无增量的组件，不会再次唤醒 Agent。`semanticImpact=possible`、未声明该判断、recipe state 不在当前 contract，或存在 provider/fixture 时，Runtime 在链接和注册前发出一个 digest-pinned component Preview exception packet。Agent 调用 `resolve_component_preview_exception` 并基于包内证据选择结构化 disposition；若结论为无可复用影响，需要以 `semanticImpact=none` 重新声明（本地 provider 也应从 recipe 移除），随后确定性流水线才继续。Runtime 不猜测组件身份或设计语义。

## Live and verification behaviour

默认态几何验证通过后立即保持 code-backed live；仅完成注册还不算可用。后台状态验证失败会阻止正式化，但不会撤掉仍然有效的默认态。真正的 surface/server 失败继续使用既有 honest fallback，不新增中间状态 UI，也不显示空白 frame。

## Compatibility

`register_component_preview`、`verify_registered_component_previews` 仍可用于诊断；`backfill_component_code_links`、`scaffold_component_harness`、`declare_component_live_heroes`、`verify_component_live_heroes` 只用于读取或修复历史记录。它们不是 Active 新组件流程的 next action。
