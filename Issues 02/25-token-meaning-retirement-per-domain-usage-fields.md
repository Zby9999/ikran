# 25 — token 区语义字段重构：`meaning` 退役为 rules 专属

Status: needs-triage

issue 24 的姊妹篇，第二步。待 issue 24 落地后启动，启动前需要一轮设计
讨论细化。先记录已锁定的方向与待决问题。

## 背景

`meaning` 目前被迫承载 N 种语义：token 用途句、规则标题、组件意图摘要。
09C-A 已记录过确定性的后果：typography 投影从 `meaning` 截尾生成 label，
又把同一 `meaning` 当 usage，同一文本必然重复
（`09C-A-design-system-reader-projection-resizable-split.md:271`）。
issue 24 把组件区从 `meaning` 摘出（组件用 `description`）；本 issue 完成
剩下的一半：token 区摘出，`meaning` 最终只绑定 rules（规则标题）。

## 已锁定方向

1. **`meaning` = rules 专属**。global / domain / layout / interaction 规则
   保持现状（规则标题，issue 19 行内编辑链路不变）。
2. **token 语义段放进 `value`**（envelope 保持纯粹，描述性字段归各
   domain 自定义）。
3. **primitive 层无语义段**：把现有特例扶正为通则（现契约已规定
   primitive color 的 meaning 必须为空字符串）。
4. **semantic 层保留一个语义段**（如 semantic color 的 usage）；
   **typography 用 `usedFor` 替代 meaning**，顺手修掉 09C-A 的
   label/usage 重复 bug。
5. **不做旧数据迁移**：原型阶段，重新抽取产出新格式（与 issue 24 决策 6
   一致）。

## 待设计讨论

- `usedFor` 的措辞纪律（与 rule_body_writing_style 同级的写作契约）；
- semantic 与 component 层 token 是否共用一个字段名（`usage` vs
  `usedFor`），还是按 domain 各自命名；
- Colors ledger / typography 投影的 view-model 迁移：usage 从 value 读取后，
  现有 meaning 消费点（token 行 usage 列、09C-A 投影 label 派生、
  `token_meaning_policy` 契约块）逐一退役；
- schema 层面 token entry 的 `meaning` 处理：可选化还是按 domain 闭集拒绝；
- 导出（derived export）与 MCP 契约通道的同步。

## 依赖

- Blocked by: 24（组件区先落地，验证「meaning 收窄」模式可行）。

## Comments

- 2026-08-04：方向由设计师拍板（「meaning 变成只和 rules 强绑定；Tokens
  区单独设计；Color 只有 Semantic 需要语义段；字体用 used for；Layout
  保持现状」）。爆炸半径提示：本 issue 会动到 schema 的
  `token_meaning_policy`、ingest、两个 token 区 view-model 与 09C-A 投影，
  比 issue 24 大一个量级，实施前单独评审计划。
- 2026-08-05：issue 24 落地（`bc06427`）后，「待设计讨论」收窄为以下
  实施决定（已写入实施 handoff
  `/tmp/ikran-25-token-meaning-retirement-handoff.md`，临时文件，以本
  issue 为准）：
  - 字段命名：typography 用 `value.usedFor`，其他 domain 的
    semantic / component 层用 `value.usage`；写错字段名 fail-closed；
  - token `meaning` 不做可选化，直接 fail-closed 禁止（沿用 issue 24 闭集
    模式）；primitive color 空 meaning 特例与 legacy repair seam
    （`design-system-legacy-repair.ts`）一并删除；
  - view-model 按 entry 类别分流：token 行读 `value.usage ?? value.usedFor`，
    rules 行继续读 `meaning`；
  - typography 投影修复随本 issue 完成：label 用 token 名，usage 列读
    `usedFor`，消除 09C-A 记录的确定性重复。
