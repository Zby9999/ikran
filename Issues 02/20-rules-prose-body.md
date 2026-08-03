# Rules Prose Body (Schema Expand + Verbatim Render + Body Editing)

Status: resolved

## What to build

规则正文散文化:layout / interaction / domain 三类规则的 `value` 接受自由文本形态(一条规则 = `meaning` 标题 + 可选散文正文)。ingest 与 view 直通正文,不做解释;Browser 将正文**原样**渲染为标题下的一段文字,不再经过有损扁平化投影。编辑 UI 从标题扩展为正文 textarea,写回复用 19 的 edit-entry 链路。Agent 从此可以用散文形态声明规则。

本票是 expand 阶段:存量富对象形态的 rule body 仍需正常 ingest 与可读渲染(可以是简单的逐行文本呈现),不允许在过渡期内让旧内容消失或变成裸 JSON。

## Acceptance criteria

- [x] schema 接受散文形态的 rule body;`meaning` 保持必填,作为唯一标题来源。
- [x] Browser 对散文正文逐字渲染(标题 + 正文),无键名剥离、无字段拼接。
- [x] 正文编辑端到端可用(textarea → edit-entry → 源文件 + DB + SSE 刷新)。
- [x] 存量富对象 body 兼容:ingest 不拒绝,显示降级为可读文本,不出现裸 JSON。
- [x] 测试:schema 单测(散文接受 / 富对象兼容 / meaning 必填)、渲染单测、e2e(散文规则从声明到显示到编辑)。

## Blocked by

- 19-rules-edit-entry-write-path(正文编辑复用其写回链路)

## Answer

schema expand 已完成：规则 `value` 可为非空散文字符串，旧富对象继续兼容；`meaning` 仍由 entry envelope 强制必填并成为散文规则唯一标题。Layout `sourceCaptures` 从正文中分离到结构化顶层字段，并通过 schema v20 的独立 DB 列 round-trip，旧 `value.sourceCaptures` 仍可读取。

Browser 对散文正文使用 `white-space: pre-wrap` 原样呈现，Domain / Interaction / Layout 均支持 textarea 编辑。单测覆盖 schema、ingest/view、投影与正文事件，真实 Chromium e2e 覆盖散文声明、标题与正文编辑、源 JSON / DB / SSE / provenance。
