# Source Artifact Declaration 与三类校验

## What to build

实现 `record_artifact_written`，让 Agent 通过宿主原生文件编辑写 source artifact 后必须声明。Runtime 只承认已声明且校验通过的 source artifact，并据此记录事件、更新 artifact index、触发 derived artifact 生成或 preview 状态。

校验分三类：semantic record schema、design-system artifact、prototype/code artifact。此 slice 先打通 declaration 和 validation framework，不要求完整设计系统浏览器或 preview。

## User stories covered

- 30, 31, 32, 58, 59, 60, 61, 62, 63

## Acceptance criteria

- [ ] `record_artifact_written` 接收 path、artifact type、semantic purpose、关联 record ids。
- [ ] Runtime 验证 path 在当前项目范围内。
- [ ] 已声明且校验通过的 artifact 进入 event log 和 artifact index。
- [ ] 未声明文件变化不进入 research export。
- [ ] 声明失败记录 invalid-artifact 或 invalid-output 事件。
- [ ] Runtime 最多请求一次修复，不补造语义。
- [ ] 测试覆盖有效声明、越界路径、未知 artifact type、校验失败、未声明文件 guard。

## Real Agent validation

- [ ] 真实 Agent 写一个最小 `token.json` 或 design-system candidate source artifact。
- [ ] Agent 调用 `record_artifact_written` 声明该 artifact。
- [ ] Runtime 记录事件并在 artifact index 中出现该 artifact。

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
