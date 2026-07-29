# Source Artifact Declaration 与三类校验

## What to build

实现 `record_artifact_written`，让 Agent 通过宿主原生文件编辑写 source artifact 后必须声明。Runtime 只承认已声明且校验通过的 source artifact，并据此记录事件、更新 artifact index、触发 derived artifact 生成或 preview 状态。

校验分三类：semantic record schema、design-system artifact、prototype/code artifact。此 slice 先打通 declaration 和 validation framework，不要求完整设计系统浏览器或 preview。

## User stories covered

- 30, 31, 32, 58, 59, 60, 61, 62, 63

## Acceptance criteria

- [x] `record_artifact_written` 接收 path、artifact type、semantic purpose、关联 record ids。
- [x] Runtime 验证 path 在当前项目范围内。
- [x] 已声明且校验通过的 artifact 进入 event log 和 artifact index。
- [x] 未声明文件变化不进入 research export。
- [x] 声明失败记录 invalid-artifact 或 invalid-output 事件。
- [x] Runtime 最多请求一次修复，不补造语义。
- [x] 测试覆盖有效声明、越界路径、未知 artifact type、校验失败、未声明文件 guard。

## Real Agent validation

- [x] 真实 Agent 写一个最小 `token.json` 或 design-system candidate source artifact。
- [x] Agent 调用 `record_artifact_written` 声明该 artifact。
- [x] Runtime 记录事件并在 artifact index 中出现该 artifact。

### 验证记录（2026-07-29，真实项目 `~/Desktop/ikran test 7`，schema v16）

- 主 Agent 经 WebBridge + 真实 MCP stdio(`bin/ikran-mcp.mjs`，非 mock client）驱动全链路：Agent 写入 6 个 design-system 源文件（design-system.json / token.json / component-list.json / components/button.json / layout-rules.json / interaction-rules.json)，逐文件 `record_artifact_written` 声明，全部 `ok:true` 并落 `source_artifacts` 表（6 行）。
- 事件链核对：`source_artifact_declared` ×7(6 次声明 + 1 次 LWW 重新声明 token.json，同一 artifact record id 更新）。
- 负例：声明一个 formalized 但 links 仅指向 `agent-proposed-designer-accepted` 卡的 component-spec,Runtime 硬挡返回 `formalized_requires_designer_edited_link`，事件 `invalid_artifact` ×1，该 artifact 不入 index（负例文件已清理）。

## Likely difficulties for Agent

- Agent 可能完成文件编辑后忘记声明。
- Agent 可能声明绝对路径、相对路径或工作目录不一致，导致 Runtime 找不到文件。
- Code artifact 的质量无法像 JSON schema 一样简单判断。

## Suggested ways through

- Tool description 强制“写完 source artifact 后立即声明”。
- Runtime 将 path canonicalize 到 project root，并给出明确 mismatch 错误。
- 对 code artifact 只做确定性检查：存在性、project scope、可选 build/preview readiness，不把代码质量伪装成语义事实。

## Blocked by

- `03-semantic-mcp-tool-boundary-mock-client.md`
- `07-design-intent-alignment-six-part-gate.md`
