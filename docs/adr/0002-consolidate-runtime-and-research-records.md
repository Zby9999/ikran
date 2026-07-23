# ADR 0002：收口 Runtime 一进程与研究记录契约

**Status:** accepted（2026-07-10）

> **Superseded in part by [ADR 0003](./0003-runtime-owned-figma-positional-evidence.md)（2026-07-12）。** Agent-first Seed、Workbench 无 seed write entry、Runtime 零 Figma 接触及 Agent-supplied Figma evidence 不再是 Active 契约；一进程、direct command kernel、SQLite canonical、append-only Evidence 与其余研究记录契约继续有效。

## 背景 / 动机

ADR 0001 完成了产品转向：Ikran 不再 spawn 无头 CLI Agent，而是作为 Agent host 的 MCP + HTTP Workbench 融合表面。随后若干 tracer-bullet issue（Workbench URL、project binding、语义 MCP、tldraw seed、evidence declaration、annotation）在迁移过程中留下了过渡实现与过渡文档：

- 两进程 coordinator（MCP/launcher spawn Next 子进程）曾作为可交付拓扑，并把「真·一进程」标成 follow-up。
- MCP 曾经 localhost HTTP 调用 Runtime route，形成 loopback。
- Seed 曾短暂存在 Workbench UI 写入口与 Agent tool 的双路径。
- 产品路径上仍残留 AgentAdapter、`/api/tasks`、fake Agent connection、mock product families 的历史表述。
- Evidence / event 持久化曾出现 record 与 audit 非同事务、JSONL 与 SQLite 角色不清的表述。
- Annotation display padding、Question proposed answer、成功研究导出门槛等研究契约尚未在 Active 标准中写清。

需要一次架构收口：保留 ADR 0001 的产品方向，把 Runtime 拓扑与研究事实契约同步为当前唯一标准（`IKRAN-MVP-PRD.zh-CN.md`），并明确历史 Issues/ADR 原文不被改写成「当时已是现状」。

## 决策

### 1. Agent-first Seed

- Seed（Figma identity + original design intent）**只**由 Agent 经语义 MCP tool 登记。
- Workbench **没有** seed URL / intent 写入口。
- Seed 身份以 canonical `file_key` / `node_id` 为准。

### 2. 一进程 custom server

- Runtime **一进程**同时承载：stdio MCP + custom Next HTTP/SSE Workbench。
- 绑定 `127.0.0.1` 自动端口；Workbench URL 含启动级 session token。
- 使用 custom Next server 意味着失去部分 Automatic Static Optimization（ASO）收益；对本地 Runtime 可接受。
- TypeScript 运行时加载采用 tsx 作为 Runtime TS loader（本地 daemon 可接受的工程取舍）。

### 3. Direct command kernel（无 MCP→HTTP loopback）

- MCP handlers 与 HTTP routes 共享同一 command kernel。
- MCP **不**经 localhost HTTP loopback 调用自身。
- Agent 与设计师操作同一组 project/session records。

### 4. 删除产品路径上的 task / adapter 平面

- 删除 / 不再作为产品路径：AgentAdapter、`/api/tasks`、fake Agent connection、mock product families。
- 测试仅保留 deterministic MCP client / test doubles。

### 5. SQLite 事务为 canonical；JSONL 为 derived export

- Record 与 event 在同一 SQLite 事务中提交。
- SQLite events 是 canonical event store。
- JSONL 是可从 SQLite 重建的 derived export，不是第二事实源。

### 6. Canonical seed 与 append-only Evidence

- Seed 使用 canonical `file_key` / `node_id`。
- Evidence package / surface 为 append-only；通过 `superseded_by` / `current_surface_id`（lineage）表达当前证据。
- `record_evidence_package` 创建 Figma Evidence Surface；未来 `record_preview` 创建 Prototype Evidence Surface。
- 不提供冗余 `create_evidence_surface` tool。

### 7. Annotation：raw semantic rect + display projection

- 持久化 raw semantic rect。
- Agent display padding 在 Workbench projection 重算，不回写为语义事实。
- 成功语义记录与 Agent annotation 原始区域可回放。
- Annotation 类型/权限的新语义留给后续 Issue，不在本 ADR 假装已冻结实现。
- Design Intent Alignment 的 Agent Annotation 与当前 attempt 及所属部分绑定并支持幂等重试。进入 answering 前，六部分必须各自先包含至少一张表达该部分已确认观察或合理假设的灰色 Agent Annotation，再包含该部分 2–5 张彩色 Question card；缺少任一类均不得 finalize。
- Agent Annotation 不计入 Question coverage；Agent 不得把已有假设伪装成问题，也不得把真实疑问伪装成已确认判断。

### 8. Question proposed / final answer 与逐卡确认

- Question card 允许 Agent `proposed_answer`。
- `proposed_answer` 只用于预填编辑器，不代表已回答，也不计入阶段 coverage。
- 设计师必须逐卡点击发送：未修改预填 → Agent 提议 / 设计师接受；编辑后 → designer edited。
- 只有非空 `final_answer` 计入 coverage；全局 `Complete` 不会自动接受或提升 proposed answer。
- 禁止空问题与空 final answer；可填「同意/对」。

### 9. 成功研究导出

- **入选门槛：** Design System v1 → 新原型 → 反馈 / 确认规则更新 → Design System v2 → 第二次新设计。仅达标项目有资格生成研究 export。
- **导出内容：** 达标后导出该项目整条成功语义链路（含闭环完成前的 seed / evidence / annotation / alignment / DS v1 / 第一次原型等），不是只导出终点。Runtime 在闭环前照常记录成功语义事实。
- **不进入研究事实/导出：** 失败请求、失败标注、草稿、取消、Open Gap、canvas layout。
- Canvas layout 可作为项目本地、可丢弃的 Workbench UX 状态持久化，以恢复
  Frame geometry 与 camera；它不写入 canonical events，不成为研究事实或导出内容。
- 运维调试仍可保留失败日志；系统并非「永不记录错误」，只是错误与草稿不属于成功研究事实。

## 替代方案与权衡

| 方案 | 为何不选 / 权衡 |
|---|---|
| 继续两进程 coordinator + MCP HTTP loopback | 状态分裂、复用指针脆弱、测试难证明 shared kernel；已用一进程 + direct kernel 收口。 |
| 保留 Workbench seed 写入口（双入口） | 研究事实来源分裂、pending UX 分叉、与 Agent-first 编排冲突。 |
| 保留 AgentAdapter / `/api/tasks` 产品平面 | 与语义 MCP tools 重复；fake connection 污染产品边界。测试 doubles 足够。 |
| 以 JSONL 为 live canonical | 双写漂移；改为 SQLite canonical + JSONL derived。 |
| 独立 `create_evidence_surface` | 与 package/preview 声明重复；surface 由声明工具创建。 |
| 把 display padding 写入语义 rect | 污染回放与跨缩放一致性；padding 留在 projection。 |
| 导出所有项目事件含失败/草稿 | 研究数据集被噪声污染；失败可留运维日志，不进研究 export。 |
| 坚持 Next ASO / 避免 custom server | 一进程共享内存与 kernel 优先于 ASO；本地 Runtime 可接受。 |

## 后果

**Active 契约以以下为准：**

- `IKRAN-MVP-PRD.zh-CN.md`（唯一产品标准）
- `CONTEXT.md`（ubiquitous language）
- 本 ADR
- `Issues 02/` 中带「2026-07-10 后续架构收口」说明的目标/验收同步

**历史材料：**

- ADR 0001 与 Issues 01–05 等完成报告保留原文；顶部标注被本 ADR / 当前 PRD 替代的部分。
- 不把旧完成报告改写成仿佛当时已是一进程 / Agent-first / 无 adapter。
- Issue 05 真实 Figma smoke 若无证据，保持未验证；自动化完成 ≠ 真实 Figma 完成。
- Issue 07–16 只同步目标与验收，不声称实现完成。

**测试后果：**

- Vitest unit + Playwright MCP/HTTP/Workbench 边界。
- 无全局 `pkill`。
- one-process / direct MCP smoke 与真实 host/Figma smoke 明确区分。

**产品工具面后果：**

- 最小 MCP 工具面删除冗余 `create_evidence_surface`。
- 保留未来 question / artifact / preview / proposal / export tools 的语义边界。
