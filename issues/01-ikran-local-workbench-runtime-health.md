# Ikran Local Workbench 启动与 Runtime Health

## What to build

建立第一个可运行的 Ikran tracer bullet：一个本地 Ikran Runtime 能通过 npm/npx 或本地脚本启动，托管浏览器 UI，并从同一个本地 origin 提供 health endpoint 与 SSE heartbeat。界面只需要足够展示单项目 Ikran workbench 的基本结构，并证明浏览器代码不会直接读写本地文件，后续所有本地能力都经过 Ikran Runtime 的同源 API。

## User stories covered

- 3
- 62
- 63
- 64
- 76
- 77
- 79
- 80

## Acceptance criteria

- [x] Ikran Runtime 可以本地启动，并托管 Browser UI 与 `/api/*` Runtime API。
- [x] Browser UI 渲染 Ikran workbench shell，包括 PRD 中的左侧流程区、中心工作区、右侧 Agent/sidebar 区和顶部阶段区。
  > **Setup 阶段不做四区 workbench shell。** 当前 project-setup 单卡界面即为 Setup 的最终 UI；四区布局（顶/左/中/右）延至进入 **React Flow 工作区**之后再实现，届时以 Figma 参考为准。
- [x] Browser UI 通过同源 HTTP 调用 `/api/health`，并能显示 ready、loading、error 状态；断开时可重试连接。
- [x] Browser UI 订阅 `/api/events` SSE heartbeat 以维持连接态（**刻意不展示** heartbeat 细节）。
- [x] Runtime 默认绑定 localhost 或 `127.0.0.1`，不启用宽泛 CORS。
- [x] 浏览器代码没有直接访问 filesystem 的路径；所有本地文件能力只通过 Ikran Runtime 暴露。
- [x] 有一个基础自动化检查或 smoke test 验证 Browser UI 到同源 Runtime health path。

## Blocked by

None - can start immediately

## Status

已完成。Runtime / health / SSE / session-token / localhost / no-FS / launcher 部分(`lib/runtime/`、`app/api/`、`bin/ikran.mjs`、smoke test)已完成并通过 `reviewer` 与 `npm run check`/`build` 验证。

### Frontend decisions (Setup)

- Setup 屏为最终 UI，不含左右侧栏；四区 workbench 在 React Flow 工作区阶段再做。
- SSE heartbeat 仅用于内部连接保活，不向设计师展示技术细节。

### Frontend implementation (Setup UI, 2026-07)

- `ProjectSetupCard` Step 1 接 `GET /api/health` + `GET /api/events`（SSE heartbeat 仅保活，不展示）。
- 三态：`loading`（「Connecting…」+ 安装说明 helper）、`connected`（绿勾 + 绿色 helper）、`disconnected`（粉色图标 + 红色 helper「Local runtime disconnected. Try again」纯文案）。
- 断连重试：点击 Step 1 行重拉 health 并重开 SSE；helper 内 Try again 不可点。
- `.setup` 去掉固定高度，内容随 Inside folder 等变体增高。
- 已移除临时预览入口（`?preview=manual-cwd`、`/preview/setup`）。
