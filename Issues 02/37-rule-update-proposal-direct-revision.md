# 37 — Rule Update Proposal 卡片内直接修改与 Revision

Status: resolved

## Parent

- `29-batch-rule-update-review.md`

## What to build

让设计师不经过 Agent 重写往返，直接在 Rule Update 卡片内修改提案标题、完整 Rule 正文和语义类别。保存产生新的不可变 revision，但不修改正式 Design System source，也不提前唤醒 Agent；理由、证据和来源交流保持只读。后续接受动作永远针对最新 revision。

## Acceptance criteria

- [x] 点击 Modify 后在原卡片内编辑 title、Rule body 与 category；取消恢复到最近已保存 revision。
- [x] 保存有意义的变化时创建新的不可变 revision，并保留旧 revision、修改者、时间与 evidence linkage；空白或无变化保存不制造 revision。
- [x] 类别变化后卡片和唯一绿点移动到新的 typed semantic target，Runtime 校验 Foundations category 与 source path 的对应关系。
- [x] 修改 proposal 不调用正式 Rule 的 live edit 路径，不写 Design System source artifact，也不创建 apply command。
- [x] 卡片、All interactions projection 和后续 Agent claim 始终指向最新有效 revision；旧 revision 只能用于审计。

## Blocked by

- `36-rule-update-review-design-system-browser-projection.md`

## Real Agent validation

- [x] Runtime/HTTP/Workbench 共用 revision command；定向测试验证 immutable revisions、no-op 拒绝和 Agent claim 最新 revision。

## Open gaps

- 若 category 修改导致目标 artifact 与原提案授权路径变化，新的 revision 必须重新计算授权目标，不能继承旧路径。
