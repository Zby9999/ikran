# 背景

用户用本地 fork 的 `pi-powerline-footer@0.6.1`（`~/.pi/agent/extensions/my-powerline-footer/`，自动发现的子目录包，entry `index.ts`）。想在 footer 加一个**每月 Token 用量**段，格式简短、以 B(billion) 为单位、1 位小数（如 `2.7B`；<1B 用 M/K）。

# 数据源调研结论

- `run-history.jsonl` 只有 `agent/task/ts/status/duration`，**无 token**。`sessions.db` 是 0 字节。**不可用**。
- 真正数据源：`~/.pi/agent/sessions/*/*.jsonl`（199 文件 / 77MB）。每条 assistant 消息 entry：`{type, id, parentId, timestamp:"2026-07-06T17:43:42.436Z", message:{role:"assistant", usage:{input, output, cacheRead, cacheWrite, reasoning, totalTokens, cost}}}`。
- fork 的 `getAgentDir()`（来自 pi-coding-agent，`~/.pi/agent/extensions/my-powerline-footer/settings.ts` 已用）返回 `~/.pi/agent`，拼 `sessions/` 即数据根。

# 设计决策（已定，用户可推翻）

1. **"每月" = 当前自然月**（按 `timestamp` 的 YYYY-MM，UTC）。每月 1 号自动重置。（备选：滚动 30 天——若用户要可改。）
2. **token 量 = sum(usage.totalTokens)**，遍历本月所有 assistant 消息。（`totalTokens` 是包自带的"总"字段；不用 input+output 重新算。）
3. **格式**：`>=1e9 → "X.XB"`（如 2.7B）、`>=1e6 → "X.XM"`、`>=1e3 → "X.XK"`、否则原数。
4. **段 id** `monthly_tokens`，加进 `default` 预设的 `leftSegments`（放在 `cost` 之后）。
5. **缓存**：异步算、非阻塞。session_start 触发一次 + 渲染时若缓存过期(>10min)再异步重算。读时只扫 mtime<31 天的文件（perf）。
6. **图标**：nerd `\uF073`(calendar)，ASCII `"M"`，段内硬编码（不改 icons.ts 的 IconSet，少动文件）。
7. **颜色**：复用 `cost` 语义色（橙，醒目；不改 ColorScheme）。
8. **隐藏**：月用量为 0 时不显示该段。

# 实施（都在 `~/.pi/agent/extensions/my-powerline-footer/` 内改 fork 源码）

## t-001 新增 `monthly-usage.ts`
- `computeMonthlyTokensAsync(agentDir)`：异步遍历 `<agentDir>/sessions/*/*.jsonl`，`fs.stat` 过滤 mtime<31 天的文件；逐行 `readline` 解析 JSONL；对 `message.role==="assistant" && message.usage?.totalTokens` 且 `timestamp` 月份==当前月(UTC) 的，累加 `totalTokens`。全程 try/catch，单文件/单行出错跳过。写回模块级 `cache={value, computedAt}`。
- `getMonthlyTokens()`：返回 `cache.value`（number，可能 0/null）；若 `cache` 空或 `Date.now()-computedAt>10*60*1000`，**fire-and-forget** 触发 `computeMonthlyTokensAsync`（不 await，不阻塞）。
- `formatMonthlyTokens(n)`：B/M/K 1 位小数（决策 3）。
- 顶层 `let computeInFlight=false` 防重入。

## t-002 `segments.ts` 加段 + `types.ts` 加 id
- `types.ts`：`BuiltinStatusLineSegmentId` 联合类型加 `"monthly_tokens"`。
- `segments.ts`：
  - `import { getMonthlyTokens, formatMonthlyTokens } from "./monthly-usage.ts"`。
  - `const monthlyTokensSegment: StatusLineSegment = { id:"monthly_tokens", render(ctx){ const n=getMonthlyTokens(); if(!n) return {content:"",visible:false}; const icon=hasNerdFonts()?"\uF073":"M"; return {content: color(ctx,"cost",`${icon} ${formatMonthlyTokens(n)}`), visible:true}; } }`（`hasNerdFonts` 已在 icons.ts export；`color` 已在 segments.ts）。
  - 注册进 `SEGMENTS` record：`monthly_tokens: monthlyTokensSegment`。

## t-003 `presets.ts` 加进预设 + `index.ts` 触发计算
- `presets.ts`：`default.leftSegments` 末尾追加 `"monthly_tokens"`（在 `cost` 后）。也可加进 `full`/`nerd`。
- `index.ts`：在 `session_start` handler 里（或合适初始化点）调 `getMonthlyTokens()`（触发首次异步计算，fire-and-forget）。import `./monthly-usage.ts`。

## t-004 验证
- `node --check` 所有改过的 .ts（monthly-usage.ts、segments.ts、types.ts、presets.ts、index.ts）。
- `/reload`，看 footer 出现月用量段（图标+数字）。新会话跑几句后数字应增长（缓存 10min 刷新）。
- 若数字不对：检查 timestamp 月份判定、totalTokens 字段名。

# 回退
改的都是 fork 本地源码（`my-powerline-footer/`）。改坏了 `cp -R` 重解压原 tarball 或 `npm pack pi-powerline-footer@0.6.1` 重来。原 `my-powerline-footer.ts.bak`（自定义版）仍在。