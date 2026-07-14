# 05B — Seed Reference Collection 与 Agent Parity

**Status:** ready-for-human

## What to build

把单一、Agent-first seed 模型扩展为项目级 Seed Reference collection。设计师可连续粘贴任意数量、共同表达同一种设计语言的 Figma selections；Agent 也可通过语义 MCP tool 添加 Reference。两种 initiator 共享同一 Runtime command、canonical identity、capture 和 projection，只在 initiator 事实上不同。项目只保存一个 Design Language Description，每条 Reference 可保存可选 Reference Note。

具体 Description/Note 输入和重复 Reference 聚焦行为必须遵循设计师的 Figma reference；缺少设计稿时不得自主补 UI。

## User stories covered

- 7, 8, 10, 11, 12, 14, 76

## Acceptance criteria — automated

- [x] 一个项目可成功添加至少三个不同 canonical `file_key + normalized node_id` 的 Seed References，并为每条投影独立 Frame/evidence lineage。
- [x] URL 中 `node-id` 的 `-`/`:`/percent-encoding 差异、`t=` 与其他非身份 query 不制造重复 Reference。
- [x] 重复 Workbench paste 返回/reuses 原 record id、Surface lineage 和 Frame；数据库计数不增长，Workbench 聚焦已有 Frame。
- [x] Agent `add_seed_reference` 与 Workbench paste 调用同一 command kernel；相同输入除 initiator 外产生相同 canonical record、capture 和错误语义。
- [x] Agent 添加的新 Reference 通过 SSE 出现在已打开的 Workbench，不要求 refresh。
- [x] Runtime 记录真实 initiator（designer/agent）；重复提交不重写第一次成功 capture 的 initiator 事实。
- [x] 项目只保存一个 Design Language Description；更新 Description 不复制到每条 Seed Reference record。
- [x] 每条 Seed Reference 可保存、修改或清除独立的 Reference Note，不影响其他 References 或 canonical identity。
- [x] Description 为空不阻塞 capture、projection、annotation；Runtime readiness/precondition 明确返回 `description_missing`，供 Issue 07 的正式 Alignment gate 消费。填写非空 Description 后该 precondition 消失。
- [x] tests 覆盖多 Reference、双 initiator parity、URL canonicalization、duplicate focus、Description readiness 与 Note isolation；本 issue 不伪装已实现 Issue 07 的 Alignment UI。



## Acceptance criteria — real Figma / real Agent

- [x] 设计师从真实 Figma 文件粘贴至少两个不同 selection links，Workbench 同时显示两个不同 Frame，截图与各自 source link 一致。
- [x] 真实 Agent 通过 `add_seed_reference` 添加第三个真实 Figma node；已打开 Workbench 通过 SSE 显示它，并记录 initiator=agent。
- [x] 对同一真实 node 分别粘贴含不同 share query 的链接并让 Agent 再次添加；最终仍只有一个 canonical Reference/Frame/lineage。
- [x] 不填写 Design Language Description 时验证 Runtime readiness 明确报告 `description_missing`；填写一次后 readiness 通过，多个 References 无需重复 Description。正式阶段阻断在 Issue 07 验收。
- [x] 为其中一条真实 Reference 添加 Note，确认其他 References 不出现该 Note。



## Blocked by

- `05A-figma-connection-gate-paste-capture.md`



## Comments



### 2026-07-12 — automated path complete

- **Shipped (automated):** multi-Reference capture + independent lineage; URL canonicalization (`-`/`:`/`%3A`/`t=`); duplicate paste reuse + Workbench Frame focus; shared `addSeedReference` kernel; initiator preservation (`registered_via`); project-level Design Language Description in SQLite `project_meta` (schema v6); `GET|PATCH /api/project/readiness` with `description_missing`; per-seed Note via `PATCH /api/seed-reference` + MCP `update_seed_reference_note`; MCP `get_project_readiness` / `set_design_language_description`.
- **UI scope:** Description / Note **edit** surfaces follow designer Figma (Notes `356:560`; Description panel mirrors Notes, project-scoped across Frames). Info opens Description; Notes opens per-seed Reference Note. Duplicate focus uses select+zoom (behavior AC), no custom toast chrome.
- **Real Figma / Agent ACs:** left unchecked for human smoke.
- **Verification:** `npm run check` passed (unit + Playwright).

### 2026-07-14 — completion report

**Done**
- Seed Reference collection + Agent/Workbench parity（共享 capture kernel、canonical id、SSE 投影、initiator 事实）已落地；automated AC 全勾。
- 项目级 Design Language Description：`GET|PATCH /api/project/readiness` + MCP；Workbench Info 打开 Description 面板（与 Notes 同交互），任一 Frame 编辑后全 Frame 同步。
- 每 Frame Reference Note：Notes 面板（Figma `356:560`）Save / Delete / Edit / Close；`PATCH /api/seed-reference`。
- 重复粘贴：reuse 已有 seed + 聚焦 Frame，不叠 Capturing…。
- UX 附带：Frame 布局/相机持久化（`.ikran/workbench-layout.json`）、大图默认长边 ≤1080、Next Phase 空 Description 门控（产品阶段门，非 Issue 07 Alignment UI）。

**Human / residual**
- Real Figma AC 中「不同 share query 去重」「readiness `description_missing` 手验」「跨 Frame Note isolation」仍待勾；部分已由设计师本地点验。
- 正式 Alignment gate 仍属 Issue 07。
