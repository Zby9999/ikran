# 41 — Rule Update Retire 与 Delete 状态展示

Status: resolved

## Parent

- `29-batch-rule-update-review.md`

## What to build

Agent 可以针对一条现有 Rule 提出 `retire`；设计师在 Rule 原位置看到 Delete 状态并完成 Accept / Reject。接受后保持 Delete 状态等待 Agent，应用成功后从有效 Rules 中移除，并在 Interaction Record 保留退休链路。

本纵切不增加独立 `Merge` 类型，也不处理一次 proposal 同时新增或更新 Rule 并批量退休多条 Rule。

## Acceptance criteria

- [x] `retire` 成为正式 Rule Update proposal kind，必须精确绑定现有 Rule 的稳定 identity、source artifact 和 base digest；不要求伪造新的 Rule 正文。
- [x] 设计师接受前不允许修改 Design System；Reject 不产生语义写入。
- [x] 接受后 Agent 只能移除提案指定的 Rule；删除其他 Rule 或产生无关修改时失败关闭。
- [x] 待删除 Rule 保留在原位置，状态标签显示 `Delete`；仅 Rule 标题使用 40% 可见度，序号、正文、编辑按钮和 Evidence 按钮维持正常可见度。
- [x] Accept 后、Agent 尚未应用时继续显示 Delete 状态，并明确处于 Waiting for Agent。
- [x] 应用成功后，该 Rule 从当前有效列表移除；Interaction Record 保留 `Retired`、退休原因和证据链。
- [x] 自动化覆盖 propose → publish → Accept / Reject → claim → exact removal → active list / history projection，并按 [Figma 节点](https://www.figma.com/design/FSgnAj1yrNlgDCt4V4wTfa/recursive-design-agent?node-id=933-7761) 验证 Delete UI。

## Blocked by

- None — can start immediately.

## Comments

- 2026-08-21：设计确认 Delete 使用浅红底 / 深红字；仅被删除 Rule 的标题降至 40% 可见度。Delete 标签、序号、正文、编辑按钮和 Evidence 按钮保持正常可见度。设计师接受后继续显示 Delete 等待态，Agent 应用成功后从有效 Rules 中移除并保留历史记录。
- 2026-08-21：实现完成。`retire` 仅允许走 managed Review，并限制在已有 Delete 原位展示的 prose Rule surfaces；声明时校验 source path、artifact kind、稳定 entry identity、base digest 与“恰好删除一条”的语义差异。完整 `npm run check` 通过（1321 unit + 83 e2e），真实 Browser 纵向覆盖 Delete、Waiting for Agent、失败关闭、应用移除与 Retired evidence history。
