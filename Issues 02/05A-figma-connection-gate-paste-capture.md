# 05A — Figma Connection Gate 与 Paste-to-Surface

**Status:** ready-for-agent

## What to build

让设计师在 Ikran 中建立安装级、只读 Figma Connection，并在连接成功后把一个 Figma selection link 直接粘贴为可视、可标注的 Figma Evidence Surface。未连接时显示设计师提供的 Figma Connection Panel、锁定画布并拒绝 paste；连接成功后 Runtime 使用 Figma REST API 捕获 screenshot 与最低 positional node index，在同一成功边界内原子提交 Seed Reference、positional evidence、Evidence Surface 和事件。

具体连接面板、锁定态、导入态和错误态必须按设计师的 Figma reference 实现；如果对应 surface 没有 Figma reference，先向设计师索取，不得自主设计。

## User stories covered

- 5, 6, 9, 14, 77, 78

## Acceptance criteria — automated

- [ ] 无 active Figma Connection 时，Workbench 显示连接面板且 canvas 不接受交互；在 canvas 粘贴 Figma link 显示明确的未连接错误。
- [ ] 无连接时 Workbench paste 与 Agent add 请求都 fail closed；SQLite 中不新增 Seed Reference、Evidence Surface 或成功事件。
- [ ] 无效 PAT 不能打开 Connection Gate，不能进入 credential store，错误响应和 UI 不回显 token。
- [ ] 有效 PAT 通过只读 Figma API 请求验证后打开 Connection Gate；Runtime/API/MCP 只能暴露连接状态和非敏感 account identity，不能返回 token。
- [ ] credential store 通过可注入 adapter 测试；PAT 不出现在项目 SQLite、`.ikran`、artifact、event payload、日志或 research export fixture 中。
- [ ] Gate 打开后粘贴有效 selection link，Runtime 获取指定 node 的 screenshot 和最低 positional index（node id/parent id/name/type/depth/visibility/bounds），并创建可见 Figma Evidence Surface；index 足以支持后续 structural overlay，但不包含完整 implementation context。
- [ ] Seed Reference、initial positional evidence、Evidence Surface 和成功事件在同一事务边界提交；任一步失败时四者均不提交。
- [ ] 无效 URL、缺少 `node-id`、403、404、429、截图缺失和 malformed Figma response 都产生可操作错误，且不留下半成品记录。
- [ ] Workbench 通过现有 SSE/projection 路径显示成功 capture，不要求页面 reload，也不要求活跃 Agent。
- [ ] one-process Playwright + MCP/HTTP 测试使用 deterministic Figma API 与 credential-store doubles，覆盖 gate closed、connect success/failure、capture success/failure 和 no-half-written-state。

## Acceptance criteria — real Figma / real macOS

- [ ] 在真实 macOS Keychain 中保存一个真实、只读 Figma PAT；验证 Ikran 重启后 connection 仍可用，但测试记录和命令输出不打印 secret。
- [ ] 使用无效 PAT 实测连接失败，并确认无 Keychain credential、无项目记录残留。
- [ ] 在没有 Agent 参与的情况下粘贴一个真实 Figma selection link；Workbench 显示与该 node 对应的真实截图，且 Seed Reference / Surface / event 可回连。
- [ ] 使用当前 PAT 无权访问的真实或受控 Figma source 实测 fail closed；不产生 Seed Reference 或成功研究事实。
- [ ] 真实验证报告明确记录 Figma plan/seat、API 结果、通过项与 open gaps，并与 deterministic automated 结果分列。

## Blocked by

- None — current repository already contains the historical Issue 05 automated projection baseline; ADR 0003 supersedes its unfinished Agent-host ingestion smoke.
