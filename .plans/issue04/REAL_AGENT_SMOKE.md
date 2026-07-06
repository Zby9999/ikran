# Issue 04 — Real external Agent seed evidence import smoke

**Date:** 2026-07-06  
**Status:** BLOCKED (honest; external CLI smoke attempted, no schema-valid package)  
**Event artifact:** `.plans/issue04/real_agent_seed_evidence_smoke.jsonl` (`real_agent_seed_evidence_smoke_recorded`)

## Goal

Manually attempt one real external Agent seed evidence import against a live Figma seed page, passing `figmaSeedReference` and `originalDesignIntent` through the Runtime → AgentAdapter boundary (or an equivalent external CLI manual smoke), and record the outcome without faking success.

## Inputs (required)

| Field | Value |
|-------|-------|
| `figmaSeedReference` | `https://www.figma.com/design/FSgnAj1yrNlgDCt4V4wTfa/recursive-design-agent?node-id=133-129&t=LwSpnKeeLinWI1kI-11` |
| `originalDesignIntent` | `This is a high-end, editorial minimalist black-and-white portfolio system where images dominate expression and text acts as a precise index.` |

Serializable task payload used for CLI stdin probes:

```json
{
  "family": "seed_evidence_import",
  "input": {
    "figmaSeedReference": "https://www.figma.com/design/FSgnAj1yrNlgDCt4V4wTfa/recursive-design-agent?node-id=133-129&t=LwSpnKeeLinWI1kI-11",
    "originalDesignIntent": "This is a high-end, editorial minimalist black-and-white portfolio system where images dominate expression and text acts as a precise index."
  }
}
```

## Environment probe (2026-07-06)

| Check | Result |
|-------|--------|
| `IKRAN_AGENT_CLI_COMMAND` / `IKRAN_AGENT_CLI_ARGS` | unset |
| `CURSOR_API_KEY` | unset |
| `FIGMA_OAUTH_TOKEN` | unset |
| `agent` CLI | `/Users/bingyizhang/.local/bin/agent` (2026.07.01-41b2de7) |
| `claude` CLI | `/Users/bingyizhang/.npm-global/bin/claude` |
| Runtime `selectAdapter()` for `seed_evidence_import` | mock adapter only (`lib/runtime/task-runner.ts`) |

## Smoke attempts (actual commands run)

### 1. Cursor Agent — hung (no output)

```sh
agent -p --force --output-format json "<prompt: Issue04 seed_evidence_import smoke with Figma MCP get_design_context …>"
```

- **Started:** 2026-07-06T13:59:43Z  
- **Outcome:** no stdout after ~390s; process killed  
- **Log:** `.plans/issue04/smoke-attempt-20260706T140000Z.log`

### 2. Claude Code CLI — Figma MCP permission blocked

```sh
printf '%s' '{"family":"seed_evidence_import","input":{...}}' | \
  claude -p --output-format json --allowed-tools "" \
  "<prompt: headless seed evidence import; reply blocked JSON if no Figma MCP>"
```

- **Started:** 2026-07-06T14:07Z (approx)  
- **Outcome:** exit 0 wrapper JSON; `permission_denials` on `mcp__plugin_figma_figma__get_design_context` and `get_metadata` (interactive approval required in headless `-p` mode)  
- **No** `seed_evidence_import` schema output

### 3. Claude Code CLI — skip permissions, model rejects Figma screenshot

```sh
printf '%s' '{"family":"seed_evidence_import","input":{...}}' | \
  claude -p --output-format json --dangerously-skip-permissions \
  "<prompt: use Figma MCP get_design_context; print seed_evidence_import JSON only>"
```

- **Started:** 2026-07-06T14:08:22Z  
- **Outcome:** exit 1; `API Error: 400 this model does not support image input` after Figma MCP returned design context with screenshot  
- **Log:** `.plans/issue04/smoke-attempt-claude-permission-20260706T140822Z.log`

### 4. Cursor Agent — honest blocked JSON (primary recorded attempt)

```sh
agent -p --yolo --output-format text \
  "Issue04 seed_evidence_import smoke. figmaSeedReference=… originalDesignIntent=…. \
   Call Figma MCP get_design_context fileKey FSgnAj1yrNlgDCt4V4wTfa nodeId 133:129 with excludeScreenshot true. \
   Reply ONLY with JSON matching seed_evidence_import schema or {\"status\":\"blocked\",\"reason\"}."
```

- **Started:** 2026-07-06T14:09:08Z  
- **Exit:** 0 (~45s)  
- **Stdout:**

```json
{
  "status": "blocked",
  "reason": "Figma MCP get_design_context is unavailable in this agent session: the plugin-figma-figma MCP tool is not exposed to the agent, FIGMA_OAUTH_TOKEN is unset, and a direct POST to https://mcp.figma.com/mcp returned Unauthorized."
}
```

- **Log:** `.plans/issue04/smoke-attempt-agent-yolo-20260706T140908Z.log`  
- **Recorded event:** `real_agent_seed_evidence_smoke_recorded` in `.plans/issue04/real_agent_seed_evidence_smoke.jsonl`

## Outcome

**Not executed end-to-end as a schema-valid `seed_evidence_import` package via external Agent CLI.**

Reasons (combined):

1. Runtime has no CLI adapter path for `seed_evidence_import` (mock only).
2. Headless `agent` CLI does not inherit Cursor IDE’s Figma MCP plugin / OAuth context.
3. Headless `claude -p` either blocks Figma MCP without interactive approval, or hits a vision-capable-model requirement when Figma returns screenshots.

This is **not** mock success masking — all attempts are logged with commands, inputs, and failure modes.

## Supplementary probe (not external CLI success)

A **Cursor IDE–hosted** Figma MCP call (`get_design_context` / `get_metadata` for `fileKey=FSgnAj1yrNlgDCt4V4wTfa`, `nodeId=133:129`) succeeded in the IDE subagent session, confirming the seed file is reachable when Figma MCP is wired to the IDE:

- Frame: `Design System Abstract - Start` (`133:129`), bounds ~1440×1024  
- Contains `Enter Panel` instance and folder chrome — consistent with Issue 04 workbench

This does **not** satisfy external Agent CLI smoke by itself; it only proves the Figma seed exists and MCP auth works inside the IDE.

## Open gaps (Issue 14 / Figma-MCP follow-on)

- Extend `selectAdapter()` so `seed_evidence_import` can target `cli-adapter` when `IKRAN_AGENT_CLI_COMMAND` is set.
- Define headless CLI contract: stdin = serializable `TaskPayload`; stdout = JSON matching `familySchemas.seed_evidence_import`.
- Ensure headless Agent environments expose Figma MCP (plugin + `FIGMA_OAUTH_TOKEN` or equivalent) or document mandatory interactive approval.
- For Claude headless path: use a vision-capable model or pass `excludeScreenshot: true` through Figma MCP when supported.
- On true success, emit `real_agent_seed_evidence_smoke_recorded` with `{ taskId, figmaSeedReference, packageId, surfaceId, agentCommand }` into project `.ikran/events.jsonl` via Runtime (currently recorded only in `.plans/issue04/` artifact).

## What *is* verified (mock path, CI)

Automated coverage in `tests/seed-evidence-workbench.spec.ts` confirms:

- Runtime creates `seed_evidence_import` tasks with both payload fields.
- Mocked AgentAdapter returns deterministic structured evidence + Figma Evidence Surface from payload input (not UI fixtures).
- Events `seed_evidence_import_started` and `figma_evidence_package_returned` are persisted to `.ikran/events.jsonl`.
- Browser UI: locked React Flow workbench → Enter Panel flow → evidence render → pan/zoom unlock; no Issue 05 artifacts.

## Suggested command once CLI routing exists

```sh
export IKRAN_AGENT_CLI_COMMAND="agent"   # or claude / codex headless wrapper
export IKRAN_AGENT_CLI_ARGS='["-p","--yolo","--output-format","text"]'
# Future: route seed_evidence_import to cli-adapter in selectAdapter()
npm run dev
# POST /api/tasks { family: "seed_evidence_import", payload: { input: { figmaSeedReference, originalDesignIntent } } }
# Expect stdout JSON → schema validation → figma_evidence_package_returned + real_agent_seed_evidence_smoke_recorded
```

Do **not** treat mock task success as a substitute for the manual real-Agent run above.
