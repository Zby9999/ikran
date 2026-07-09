# Seed-entry UX + Figma screenshot 4096 (Ikran-side) Implementation Plan

> **For agentic workers:** Use subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** After the designer registers a Figma seed URL, the Workbench shows a central loading Evidence Surface until the Agent (via Figma MCP + `record_evidence_package`) supplies a screenshot; Ikran MCP conventions require `get_screenshot` with `maxDimension: 4096` and automatic seed→evidence orchestration. Runtime never contacts Figma.

**Architecture:** Two initiators, one user journey. UI/Runtime: `register_seed_reference` → projection `awaiting_evidence` (loading) → poll surfaces → show screenshot. Agent: on successful seed registration (same session), Figma MCP screenshot at 4096 → `record_evidence_package`. Conventions live in Ikran MCP `instructions` + tool descriptions only.

**Hard constraints (from AGENTS.md):**
- Do **NOT** edit anything under `workflow/`.
- `workflow/` Skills are not Ikran MCP and must not encode Ikran product behavior.
- Do **NOT** design “no Agent session” UX — normal path is Agent-initiated MCP.
- Runtime zero Figma contact remains absolute.

**Tech Stack:** `bin/ikran-mcp.mjs`, tldraw Workbench shapes/CSS, Playwright e2e, `docs/manual-agent-smoke-issue05.md`, optionally `Issues 02/05-…`.

**Workspace:** `/Users/bingyizhang/Desktop/recursive-design-agent` (no worktree). Commit per task when done; do not push unless asked.

---

## File map

| File | Change |
|------|--------|
| `bin/ikran-mcp.mjs` | Expand `instructions`; strengthen `register_seed_reference` + `record_evidence_package` descriptions (4096 + orchestration) |
| `components/workbench/seed-reference-projection-shape.tsx` | Loading / awaiting_evidence media state |
| `components/workbench/seed-evidence-workbench.css` | Loading chrome (minimal; prefer Figma if exists — else ask… for this slice use a minimal spinner matching existing purple frame language, no Design-issue invention) |
| `components/workbench/workbench-canvas.tsx` | Pass awaiting flag when seed exists without screenshot surface |
| `tests/seed-evidence-workbench.spec.ts` | Assert loading until surface; then screenshot |
| `docs/manual-agent-smoke-issue05.md` | 4096 default convention + auto seed→evidence |
| `Issues 02/05-…` or short note in plan only | Optional AC note — do not fake Real Agent checks |

---

### Task 1: Ikran MCP conventions (4096 + seed→evidence)

**Files:** `bin/ikran-mcp.mjs` only (plus optional one-line pointer in `AGENTS.md` if needed — prefer MCP only).

- [ ] Update server `instructions` to state clearly:
  1. After `register_seed_reference` succeeds in a session where the designer just provided a Figma seed, the Agent MUST immediately use the host **Figma MCP** `get_screenshot` with **`maxDimension: 4096`** (never rely on the Figma MCP default 1024), then call Ikran `record_evidence_package` with the screenshot (`artifactPath` and/or `dataUrl`) and explicit `evidenceViews`.
  2. Runtime / Ikran tools never fetch Figma.
  3. Workbench will show loading until an Evidence Surface with screenshot arrives.
- [ ] Update `register_seed_reference` tool description: success is not the end — Agent must continue to Figma screenshot @4096 + `record_evidence_package`.
- [ ] Update `record_evidence_package` tool description: screenshots for this product MUST be captured with `maxDimension: 4096`; prefer declaring after that capture.
- [ ] Do not edit `workflow/`.
- [ ] Commit: `docs: require 4096 Figma screenshots and seed-to-evidence MCP flow`

---

### Task 2: Workbench `awaiting_evidence` loading → screenshot

**Files:** workbench shape, CSS, canvas sync, tests.

Behavior:
- Seed registered, no Evidence Surface with screenshot yet → projection media shows **loading** (central, in the frame media area), `data-awaiting-evidence="true"` (or equivalent testid).
- When surface arrives with screenshot (dataUrl or artifact URL) → loading ends, image shows (existing sharp sizing path).
- Seed-only without waiting forever in tests: e2e can POST seed then assert loading, then POST evidence and assert screenshot.
- No “open Workbench without Agent” empty-state copy beyond simple loading.
- Do not invent Design-issue UI; keep purple frame language; simple spinner/pulse is OK if no Figma for this micro-state (user confirmed product intent).

- [ ] Implement awaiting flag in projection targets (seed present, no screenshot src yet).
- [ ] Shape + CSS loading state.
- [ ] E2E: loading visible after seed; screenshot after evidence package.
- [ ] Commit: `feat: show awaiting-evidence loading until Figma screenshot surface arrives`

---

### Task 3: Smoke / product docs (no workflow/)

**Files:** `docs/manual-agent-smoke-issue05.md`; optionally brief note in `Issues 02/05-agent-host-figma-evidence-declaration.md` (open gaps / suggested flow only — do not check Real Agent boxes falsely).

- [x] Document: Agent must use maxDimension 4096; after register_seed_reference continue to evidence; Workbench loading until surface.
- [x] Explicit: conventions live in Ikran MCP, not workflow Skills.
- [x] Commit: `docs: document auto seed-to-evidence and 4096 screenshot convention`

---

## Out of scope

- Editing `workflow/**`
- Runtime calling Figma
- MCP Prompts/Resources / SEP-2640 skills packaging (later)
- No-Agent-session UX
- Soft PNG resolution warnings on record (optional later)
