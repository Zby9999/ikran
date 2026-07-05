# Seed Prototype Scaffold 与实时预览

## What to build

让 agent 将原始 seed page 重建为真实本地 prototype，并通过 live preview 展示。MVP 阶段，mocked path 应能在用户选择的项目文件夹中初始化或填充 Next.js、TypeScript、Tailwind、npm 的 prototype surface，然后由 Ikran Runtime 管理 preview readiness、iframe embedding 和 Prototype Evidence Surface。

Seed prototype review 不是截图浏览。Browser UI 使用真实 iframe surface；区域标注以 iframe 可视区域选择为入口，并可通过 Runtime 的非侵入式 DOM inspection 补充 selector/id/data 属性、候选 component id、候选元素 bounding box 和 overlap ratio。

## User stories covered

- 39
- 40
- 41
- 42
- 43
- 44
- 45
- 46
- 47
- 48
- 72

## Acceptance criteria

- [ ] Browser UI 能在 draft design-system artifacts 存在后启动 seed reconstruction task。
- [ ] mocked adapter 在用户选择的本地项目文件夹中创建或更新默认 PRD stack 的 prototype scaffold。
- [ ] prototype 在概念上以 `workflow/design-system/token.json` 作为 design-token source，Tailwind 只是 derived implementation mapping。
- [ ] Ikran Runtime 启动或检测 local dev server，并暴露稳定 preview URL。
- [ ] Browser UI 将 preview URL 嵌入 iframe，并提供 focus action 直接打开 preview URL。
- [ ] Browser UI 将 seed reconstruction preview 表现为 React Flow 中的 Prototype Evidence Surface。
- [ ] prototype region selection 可以产出 bounding box、normalized rect、selected crop，以及可用的 DOM candidates；DOM inspection 失败时 region annotation 仍有效。
- [ ] UI 能展示 preview status，且 agent 不需要承担 process supervisor 责任。
- [ ] 记录 `seed reconstruction started` 和 `preview started` 语义事件。
- [ ] 测试或 smoke check 验证 preview readiness 能反映到 UI。

## Blocked by

- `06-draft-design-system-artifacts.md`
