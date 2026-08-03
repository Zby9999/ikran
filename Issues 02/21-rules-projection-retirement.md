# Rules Projection Retirement + Layout Placard Simplification

Status: resolved

## What to build

退役规则区的前端有损投影,让"显示文字 = 源 JSON 文字"在规则区完全成立。Domain Rules 区和 Interaction 页删除扁平化逻辑(点路径标签、数组拼接、键名剥离),只渲染标题 + 正文。Layout placard 删除"识别空间键拼成的 facts 行"——这些值现在由规则正文自己表达;截图、stale 判定、provenance caption 保持不变。Technical details 的原始 JSON 层保留,作为唯一的检查层。

连带删除/重写 pin 住旧投影行为的单元测试。

## Acceptance criteria

- [x] Domain Rules 区与 Interaction 页只渲染标题 + 正文;旧扁平化投影代码删除。
- [x] Layout placard 的 facts 行移除;capture、stale verdict、provenance caption 行为不变(含无 capture 的诚实占位块)。
- [x] 主阅读层任何路径都不出现裸 JSON;raw JSON 仅在 Technical details。
- [x] pin 旧投影的单测删除或重写为 pin 新行为;`npm run check` 全绿。

## Blocked by

- 20-rules-prose-body(散文渲染已落地,旧投影才有替代)

## Answer

Domain / Interaction 已统一为 `meaning` 标题 + 正文；旧 `statement` 提升、点路径展开、字段数组拼接全部删除。Layout projection 删除所有 key/name-driven facts 识别与 facts 行，只保留标题、正文、capture、stale 与 provenance caption。

expand 过渡期的旧对象仅通过通用递归文本降级显示，不读取任何富字段语义，也不输出裸 JSON；相关投影与 Browser 单测已重写为新 contract。19–23 收尾时完整 `npm run check` 已通过。
