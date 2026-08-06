# Human-Intent New Prototype Loop

Status: implemented（机制；Workbench intent 入口 UI 仍推迟）

> **修订记录(2026-08-06)**:原地改写。变化:新增相位门(Design System 未正式化不得开新设计 run,见 Issue 28);新增**会话边界**——新设计 = 新对话会话;新增**生成隔离不变量**——新设计 run 的合法输入仅为设计师新 intent + 当前 design-system source,反馈库、事件日志、annotation、旧对话一律不得进入生成上下文(见 Issue 27)。`record_preview` / Prototype Surface 细节移至 Issue 30;rule update 移至 Issue 29。

## What to build

实现 seed startup 后的主要循环:设计师输入新的 prototype intent,Agent 消费当前**正式化** design system(DS v1+)创建新 prototype code,声明 source artifacts 和 preview,Runtime 创建 prototype run record 和 Prototype Evidence Surface(Issue 30),Workbench 显示 surface。

此 slice 验证设计系统是否能被用于新设计,而不是只重建 seed page。

**会话边界与生成隔离**:新设计 run 从一个新的 Agent 对话会话开始。该会话中 Agent 的合法输入只有两样:设计师的新 intent + design-system source(经工具交付,如 `prepare_*` 的 source contract)。上一个设计的迭代历史留在旧对话里,不带入;反馈库(Issue 27)在生成中不可读。这条不变量意味着:**过去影响未来设计的唯一通道是 Design System source**——任何信息想影响新设计,必须先经 Issue 29 审查提升为 Rule。

**相位门**:项目未进入 `ready_for_new_design`(Issue 28)时,Runtime 拒绝创建新设计 run。

## User stories covered

- 39, 41, 42

## Acceptance criteria

- [ ] Workbench 提供 human-intent new prototype 输入入口。
- [x] 项目相位非 `ready_for_new_design` 时,新设计 run 声明被 Runtime 拒绝。
- [x] Runtime 交付给 Agent 的任务上下文仅包含 intent 与 design-system source(version 明确),不包含反馈记录、事件日志、历史 annotation。上下文契约标明 Formalized / Candidate 两级优先级(Formalized 硬参考,Candidate 软参考,冲突时 Formalized 优先且冲突显式标记)。
- [x] Agent 生成中若实际依赖某条 Candidate 条目,须在 artifact 声明或提案中显式标注所依赖的 Candidate id;依赖记录进入事件日志,供 Issue 29 审查时按使用频率优先裁决。
- [x] Agent 创建或更新 prototype code,并声明 source artifacts。
- [x] Runtime 创建 prototype run record,链接到 design-system version。
- [ ] Workbench 显示新的 Prototype Evidence Surface(多嵌单活,见 Issue 30)。
- [x] 测试覆盖 intent submit、相位门拒绝、生成上下文 payload 隔离、artifact declaration、run metadata linkage。

## Real Agent validation

- [ ] 真实 Agent 在新会话中仅使用 intent + design-system source 创建一个新 prototype surface,并声明 artifact 和 preview。
- [ ] 手动验证新 prototype 引用 design-system source/context,而不是靠上一段对话的 prompt memory 或反馈库。

## Likely difficulties for Agent

- Agent 忽略 design system,直接按用户 intent 自由设计。
- Agent 在同一会话中携带上一设计的迭代历史生成新设计(会话边界被破坏)——Runtime 无法管宿主上下文,靠工作流约定:新设计开新对话。
- 多个 prototype run 的 preview URL 和 source files 容易混淆。
- 新原型可能破坏既有 prototype 的 dev server 或路由。

## Suggested ways through

- Agent context packet 明确列出 design-system version、token paths、component constraints,且不包含任何反馈/历史记录入口。
- Prototype run record 必须包含 run id、source paths、preview path、design-system version。
- 鼓励路由或目录隔离不同 prototype run,避免覆盖既有 prototype。
- 相位门由 Runtime 硬校验,不依赖 Agent 自觉。

## Blocked by

- `09-draft-design-system-derived-view.md`
- `28-phase-state-machine-design-system-formalization.md`(相位门)
- `30-prototype-surfaces-multi-embed-single-live.md`(record_preview 与 surface)
