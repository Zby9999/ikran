# 项目文件夹选择与 `.ikran` 元数据

## What to build

让设计师通过 Browser UI 和 Ikran Runtime 把 Ikran 绑定到一个空的本地项目文件夹。文件夹选择优先使用系统原生 folder picker；Browser UI 只触发 Runtime API，不直接访问本地 filesystem。文件夹通过校验后，Runtime 创建项目本地 `.ikran/` 元数据、初始化持久状态、写入第一批语义事件，并返回足够的项目状态，让 Browser UI 退出未绑定状态。

## User stories covered

- 2
- 38
- 61
- 70
- 71
- 78
- 80

## Acceptance criteria

- [x] Browser UI 提供文件夹绑定流程（具体交互以 Figma 为准），通过 Runtime API 触发 picker / bind。
- [x] Runtime 返回用户选择的真实本地路径；如果原生 picker 不可用，可以回退到手动输入路径并进行校验。
- [x] Runtime 校验该文件夹是否适合作为新的单流程 Ikran 项目；不适合时返回可理解的错误。
- [x] 成功后，Runtime 创建项目本地 `.ikran/` 元数据，包括 config、SQLite state 和 event log 位置。
- [x] event log 至少记录 `project created` 和 `folder selected` 两类语义事件。
- [x] 刷新 Browser UI 后，可以从 Runtime 恢复 active project 状态。
- [x] 测试使用临时空文件夹，验证 `.ikran/` 元数据和事件被创建。

## Status

已完成。实现包括 `lib/runtime/project.ts`、SQLite/JSONL 事件日志、系统原生 folder picker（macOS/Linux/Windows）、手动路径回退、`/api/project/*` Runtime API，以及 UI 绑定流程。`npm run check` 通过，使用 `~/Desktop/ikran-test` 手动验证 `.ikran/` 元数据、SQLite 表结构、JSONL 事件和 Runtime 全局 active project 指针均正常工作。

### P2 fix — SQLite 初始化连接句柄泄漏

`bindProjectFolder` 原先调用 `openProjectDb(resolved)` 只为建 schema，但返回的 `better-sqlite3` 连接没有 `closeProjectDb`，句柄只能等 GC 回收，长时间运行或反复绑定会累积未关闭句柄，也可能占用文件锁影响后续删除/重置项目目录。已在 `lib/runtime/db.ts` 新增专门的 `initializeProjectDb()`（`openProjectDb` + `try/finally` + `closeProjectDb`），并把 `lib/runtime/project.ts` 的调用点改为使用它。语义不变，只是不再泄漏句柄。`tsc --noEmit` 与 `tests/project-folder-binding.spec.ts`（2 tests）均通过。

## Blocked by

- `01-ikran-local-workbench-runtime-health.md`

---

## 补充：启动时 cwd 自动绑定

### 背景

PRD 故事 76（npm/npx 启动）的目标用户里有一类“懂一点代码”的设计师：他们在 IDE 终端里 `cd` 进一个项目文件夹，然后 `npx ikran`。此时他们的意图已经是“绑这个文件夹”，应当自动匹配，而不是再弹一次系统文件夹选择器。本补充项在不新建 issue 的前提下扩展 Issue 2 的文件夹绑定流程，覆盖这条快路。

本补充项同时修复一个前置工程问题：当前 `bin/ikran.mjs` 启动 `next dev` 时未指定 app 目录，Next.js 以 `process.cwd()` 作 app 根，导致 `npx ikran` 只能在本仓库根目录启动。需要把“app 目录”（package 相对、固定）与“用户项目文件夹”（cwd 或 `--folder`，可变）分开。

### 范围

两层：

1. **Launcher 层**：`bin/ikran.mjs` 解析 app 目录（package 相对），以 `next dev <appDir>` 启动；把用户项目文件夹以 `IKRAN_CWD` 环境变量传入 Next 进程；新增 `ikran --folder <path>` CLI flag（将 `IKRAN_CWD` 设为该值）。
2. **Runtime + UI 层**：Runtime 读 `IKRAN_CWD` 作 cwd 候选（不读 `process.cwd()`），过安全门后通过 `GET /api/project` 暴露；UI 在无 active project 且候选可 auto-bind 时，调用现有 `/api/project/bind` 完成绑定。

### 决策

- **Auto-bind 范围（安全门）**：
  - cwd 已有 `.ikran/config.json` → resume，直接 auto-bind，免确认。
  - cwd 为空文件夹（允许 `.DS_Store` 等系统噪声）→ init，直接 auto-bind，免确认。
  - cwd 有内容且非 ikran 项目 → 不 auto-bind；UI 显示“使用当前文件夹：xxx”一键确认按钮，与“Select a Folder”并列。
- **CLI flag**：现在加 `ikran --folder <path>`。
- **子目录启动**：MVP 不做 git 式向上查找；记为已知限制，文档说明需在项目根目录启动。
- **优先级**：cwd 候选（若可 auto-bind）优先于已存 `~/.ikran/runtime-state.json` active 指针；冲突时以 cwd 为准并更新指针。
- **事件**：auto-bind 仍走 `bindProjectFolder`，复用现有 `project_created` / `folder_selected` 事件；resume 时 `project_created` 重复记的降噪留作后续可选打磨。

### 补充验收项

- [x] `npx ikran` 可在任意 cwd 启动；app 目录由 launcher 解析，不依赖 cwd。
- [x] launcher 将用户项目文件夹以 `IKRAN_CWD` 传入 Runtime；Runtime 用 `IKRAN_CWD`、不用 `process.cwd()` 作候选。
- [x] `ikran --folder <path>` 可显式指定项目文件夹，等价于在该文件夹内启动。
- [x] cwd 为空 或 已有 `.ikran/` 时，UI 启动后自动完成绑定，无需手动选文件夹；`project_created` / `folder_selected` 事件正常记录。
- [x] cwd 有内容且非 ikran 项目时，不静默绑定；UI 提供“使用当前文件夹”一键确认。
- [x] cwd 候选优先于已存 active 指针；两者冲突时以 cwd 为准并更新指针。
- [x] 已知限制写入文档：在项目子目录内启动不会自动恢复到项目根。
- [x] `npm run check` 通过；新增 e2e：在临时空文件夹 cwd 启动，验证自动绑到该文件夹并生成 `.ikran/`。

### Status

补充项已实现并通过验证（`npm run check` 11 tests 全绿）。

- launcher（`bin/ikran.mjs`）：解析 app 目录并以 `cwd=appDir` 启动 Next；用户项目文件夹经 `IKRAN_CWD` 传入；新增 `--folder <path>`，且 `--folder` 严格解析——缺值或下一个 token 是 flag 时打印 usage 并退出（`ikran --folder` / `ikran --folder --no-open` 已验证 fail-fast）。从仓库外目录 smoke 启动验证 OK。
- Runtime（`lib/runtime/cwd-candidate.ts`）：`getCwdCandidate()` 读 `IKRAN_CWD`，按 `.ikran/config.json` 存在 / 文件夹为空 / 有内容分出 `resume` / `init` / `manual` 三态；`GET /api/project` 扩展返回 `cwd_candidate`。
- UI（`ProjectSetupCard`）：加载时按候选 kind 自动绑定（`resume`/`init`）或显示 “Use Current Folder” 一键确认（`manual`），无候选时走原 picker；cwd 候选优先于已存 active 指针。
- 测试（`tests/cwd-auto-bind.spec.ts`）：`getCwdCandidate` 四态单元 + UI auto-bind / 手动确认 + 真实 `/api/project` 字段。

已知限制（如决策所定）：在项目子目录内启动不会自动向上找项目根，需在项目根目录启动。

### Frontend decisions (Setup)

- 绑定成功：helper 显示文件夹路径即可；**不**额外提示「元数据已创建」，**不**单独展示 `project.name`。
- 绑定失败：语义化错误文案（`folder-error-message.ts`），不暴露 error code。
- `cwd_candidate` manual：Figma **Inside folder** 变体（`Select a Folder` 行 + `Choose a local folder` + `Use this folder directly` 子按钮）；子按钮调用 `/api/project/bind`。
- Runtime Step 1 断连：helper 红色语义化文案含「Try again」纯文本；重试靠点击 Step 1 行。
- `Start Building` 在无限画布未就绪前为**无 handler 的占位按钮**；三步完成后仅亮起，属预期行为。
- `Design issue/` 仅供设计师沟通，不作为编码参考。

### Frontend implementation (Setup UI, 2026-07)

- 抽出 `FolderSelectStep`：`inactive` / `default` / `inside-folder` / `complete` 四变体；`inside-folder` 由 `GET /api/project` 的 `cwd_candidate.kind === "manual"` 驱动。
- Inside folder 底栏：`folder-step-footer` 高 16px、左 padding 6px、**右 padding 0**（子按钮右缘与大行对齐）；子按钮 `10px` / `padding 4px 8px` / `letter-spacing -0.3px`。
- 绑定失败：`folder-error-message.ts` → 红色 helper；inside-folder 错误时 footer `is-expanded` 允许换行。
- 过程态 helper：`Opening folder picker…` / `Binding {path}…`；成功为绿色 `Complete! {path}`。
