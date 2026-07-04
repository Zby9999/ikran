# Issue 2 补充：启动时 cwd 自动绑定

## 来源与事实源

- 产品背景：`MAP-MVP-PRD.zh-CN.md`（故事 76 npm/npx 启动、78 原生文件夹选择器、81 未来桌面包装）。
- 本补充的完整说明、决策、验收项已写入 `issues/02-project-folder-ikran-metadata.md` 末尾「## 补充：启动时 cwd 自动绑定」一节。**该节是事实源**，本计划任务与之对齐。
- 不新建 issue；Issue 2 原有验收项已「已完成」，本补充是叠加增强。

## 要解决的两层工程

### 层 1（前置）：launcher 分离「app 目录」与「用户项目文件夹」

**现状问题**：`bin/ikran.mjs` 启动 `next dev` 时未传目录参数，Next.js 以 `process.cwd()` 作 app 根去找 `app/`。结果 `npx ikran` 只能在 `recursive-design-agent` 仓库根目录启动；设计师在 `~/Desktop/empty-folder` 里跑 `npx ikran`，Next.js 找不到 app，起不来——auto-bind 无从发生。

**做法**：
- launcher 用 `import.meta.url` / `createRequire` 解析 app 目录（= 包根，`package.json` 所在目录，`app/` 的父）。以 `next dev <appDir>`（或 `spawn(..., { cwd: appDir })`）启动。
- 启动前捕获用户项目文件夹 = `--folder` 值（若有）否则 `path.resolve(process.cwd())`，作为 `IKRAN_CWD` 环境变量传给 Next 子进程。
- 新增 CLI flag `ikran --folder <path>`：把 `IKRAN_CWD` 设为 `path.resolve(<path>)`。
- **关键后果**：Next 服务里 `process.cwd()` = app 目录，不再是用户项目目录。Runtime 必须读 `IKRAN_CWD`（不是 `process.cwd()`）拿候选文件夹。这个 env 方案在 launcher 正确分离两目录后是**必须**的，不是可选优化。
- 保留现有 localhost 限制、`--no-open`、`--port`、`--prod` 等参数。

### 层 2（功能）：Runtime cwd 候选 + 安全门 + UI auto-bind

**Runtime（`lib/runtime/`）**：
- 新增 `getCwdProjectCandidate()`：读 `process.env.IKRAN_CWD`；未提供则返回 null（不回退 `process.cwd()`）。
- 安全门 `isAutoBindable(dir)`：
  - `existsSync(path.join(dir, ".ikran/config.json"))` → `{ kind: "resume", path: dir }`。
  - `readdirSync(dir)` 过滤掉 `.DS_Store` / `Thumbs.db` 后为空 → `{ kind: "init", path: dir }`。
  - 否则 → `null`（不可 auto-bind；UI 可显示一键确认）。
- `GET /api/project` 响应扩展：在原有 `active` 之外，返回 `cwd_candidate: { path, kind } | null`。
- 优先级语义：响应里若 cwd 候选可 auto-bind，它优先于已存 active 指针（UI 据此决定绑谁）；cwd 不可 auto-bind 时仍返回已存 active（现有恢复行为不变）。

**UI（`components/setup/ProjectSetupCard.tsx`）**：
- 加载时 `GET /api/project` 返回 `cwd_candidate` 且 `kind` 为 `resume`/`init` 且无 active（或 active 与 cwd 冲突）→ 自动调 `/api/project/bind`，绑定 `cwd_candidate.path`，免确认。
- `cwd_candidate` 存在但不可 auto-bind（有内容、非 ikran 项目）→ 显示「使用当前文件夹：xxx」一键确认按钮，与「Select a Folder」并列；点击即调 `/bind`。
- 无 `cwd_candidate` → 现有 picker 流程不变。
- 绑定一律走现有 `/api/project/bind`，不在服务端另开 startup 副作用路径。

### 事件与已知限制

- auto-bind 复用 `bindProjectFolder`，沿用 `project_created` / `folder_selected`；resume 时 `project_created` 重复记的降噪留作后续可选打磨，本期不做。
- 已知限制（写入文档/Issue 2 补充节）：在项目子目录内启动不会自动向上找项目根；需在项目根目录启动。MVP 不做 git 式向上查找。

## 验证

- `npm run check`（typecheck + e2e）通过。
- 新增 e2e：在临时空文件夹作为 cwd 启动 ikran，验证自动绑到该文件夹并生成 `.ikran/`（config + events.jsonl 至少含 `project_created`、`folder_selected`）。
- 手动验证：在已有 `.ikran/` 的项目根启动 → 免确认恢复；在非空非项目文件夹启动 → 显示一键确认而非静默绑定；`ikran --folder <path>` 等价于在该 path 内启动。

## 不在本计划内

- 桌面包装（Tauri/Electron，故事 81）相关：最近项目列表、`.ikran` 文件关联、桌面级 Open Folder 主入口。这些属于包装期，且届时 `process.cwd()` 不再是用户项目目录，cwd-auto-bind 机制本身让位给包装期的项目发现机制。
- 子目录向上查找（git 式 root discovery）。
- `project_created` vs `project_resumed` 事件区分。