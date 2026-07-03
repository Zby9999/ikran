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

- [x] Browser UI 提供简单的项目文件夹绑定流程，并通过 Ikran Runtime API 触发系统原生 folder picker。
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
