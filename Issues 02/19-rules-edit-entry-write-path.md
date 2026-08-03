# Rules edit-entry Write Path (Tracer Bullet: Title Editing)

Status: resolved

## What to build

设计师在 Design System Browser 里对任意一条规则的标题(`meaning`)做行内编辑并保存。保存走一条新的 Runtime 写回链路,完全复用 approval 的三段式:定位源 JSON 文件中的条目 → schema 校验 → 规范化序列化写回文件 → 同事务更新 DB → 记语义事件 → SSE 通知 Browser 刷新。这是打通"前台改动直写源 JSON"整条链的最窄竖切,本身可演示。

状态语义按 ADR 0005:formalized 编辑后保持 formalized;candidate 保持 candidate;gap 条目被填入标题后变 candidate。每次编辑记 `design_system_entry_edited` 事件(含前后文),并让编辑记录出现在该条目的 ⓘ 证据层,保证证据链不与显示文字脱节。

编辑 UI 由 Agent 在现有规则卡片 chrome 基础上自行设计(本轮无 Figma 参考,改动以在原基础上的增补为准)。

## Acceptance criteria

- [x] HTTP 新增 `edit-entry` action:接受 (sourceArtifactPath, entryId, field, text);拒绝路径逃逸 / 条目不存在 / 空文本 / 不支持的字段;写入前过 schema 校验。
- [x] 写回顺序与失败恢复与 approval 一致(先文件、后 DB 事务、失败恢复原始字节);DB 更新与事件在同一事务提交。
- [x] `design_system_entry_edited` 事件落事件日志,含 before/after 文本;SSE design-system 事件触发 Browser 重新拉取。
- [x] 状态语义:formalized / candidate 不变;gap → candidate。
- [x] 规则卡片上有可用的行内编辑入口(标题),保存/取消行为符合现有卡片交互语言。
- [x] 编辑历史在 ⓘ 证据层可见(形式可从简,但不允许显示文字与证据链静默矛盾)。
- [x] 测试:command 单元测试(成功、各拒绝路径、状态转换、文件恢复)+ e2e(编辑 → 源文件变化 → 刷新后显示新值)。

## Blocked by

None — ADR 0005 已定案,可立即开始。

## Answer

已完成 `edit-entry` 的 Runtime / command / HTTP / Browser 全链路。写回采用源文件优先、DB 与语义事件同事务、失败恢复原始字节；交错编辑按无 etag LWW 处理，败方保留赢家字节并记 `invalid_output`。编辑事件 id 同步加入条目 links，Browser view 将其解析为 ⓘ Designer edits 历史。Domain、Interaction、Layout 卡片共享标题编辑控件。

验证：`tests/unit/design-system-edit.test.ts` 覆盖成功、输入拒绝、状态转换、schema 漂移、恢复与并发；`tests/design-system-browser.spec.ts` 覆盖真实 UI → 源 JSON → DB → event → SSE → provenance，Chromium 单票通过。
