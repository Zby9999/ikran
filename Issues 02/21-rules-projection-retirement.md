# Rules Projection Retirement + Layout Placard Simplification

Status: ready-for-agent

## What to build

退役规则区的前端有损投影,让"显示文字 = 源 JSON 文字"在规则区完全成立。Domain Rules 区和 Interaction 页删除扁平化逻辑(点路径标签、数组拼接、键名剥离),只渲染标题 + 正文。Layout placard 删除"识别空间键拼成的 facts 行"——这些值现在由规则正文自己表达;截图、stale 判定、provenance caption 保持不变。Technical details 的原始 JSON 层保留,作为唯一的检查层。

连带删除/重写 pin 住旧投影行为的单元测试。

## Acceptance criteria

- [ ] Domain Rules 区与 Interaction 页只渲染标题 + 正文;旧扁平化投影代码删除。
- [ ] Layout placard 的 facts 行移除;capture、stale verdict、provenance caption 行为不变(含无 capture 的诚实占位块)。
- [ ] 主阅读层任何路径都不出现裸 JSON;raw JSON 仅在 Technical details。
- [ ] pin 旧投影的单测删除或重写为 pin 新行为;`npm run check` 全绿。

## Blocked by

- 20-rules-prose-body(散文渲染已落地,旧投影才有替代)
