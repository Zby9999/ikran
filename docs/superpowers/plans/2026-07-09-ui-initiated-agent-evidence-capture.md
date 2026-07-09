# UI-initiated Agent seed evidence capture Implementation Plan

> **For agentic workers:** subagent-driven-development. Do NOT edit `workflow/`.

**Goal:** When the designer registers a Figma seed via the Workbench **plus / EnterPanel** (HTTP `POST /api/seed-reference`), the Agent can discover that pending work through Ikran MCP and complete Figma MCP `get_screenshot(maxDimension:4096)` + `record_evidence_package` — without Runtime contacting Figma.

**Architecture:** UI register writes the same `seed_references` fact. Seeds with no Evidence Surface screenshot are **pending agent work**. New MCP tool `list_pending_seed_evidence` returns them. MCP `instructions` require: after `open_workbench`, and whenever helping with Workbench seed entry / awaiting loading, call this tool and fulfill immediately. UI keeps awaiting-evidence loading (already) and may show a short “waiting for Agent capture” hint.

**Constraints:** Zero Runtime Figma; no `workflow/` edits; normal path is Agent-connected (no no-Agent UX).

**Workspace:** repo root. Commit per task; do not push.

---

### Task 1: Runtime list pending seeds awaiting evidence

**Files:**
- `lib/runtime/seed-reference.ts` or new `lib/runtime/pending-seed-evidence.ts`
- `app/api/pending-seed-evidence/route.ts` (GET)
- unit test

Logic: active project’s `seed_references` that have **no** `figma_evidence_surfaces` row with a usable screenshot (`screenshot_data_url` or `screenshot_artifact_path` non-empty). Return `{ id, figma_seed_reference, original_design_intent, created_at }[]` oldest-first.

- [ ] Implement list helper + GET (auth + active project like seed-reference)
- [ ] Unit tests
- [ ] Commit: `feat: list seeds awaiting evidence screenshot`

---

### Task 2: MCP tool + instructions for UI-originated capture

**Files:** `bin/ikran-mcp.mjs`

- [ ] Register `list_pending_seed_evidence` (no args) → GET proxy
- [ ] Update `instructions`: UI plus path also creates pending work; after `open_workbench` and when designer uses Workbench / awaiting loading, **must** call `list_pending_seed_evidence` and for each item run Figma `get_screenshot` @4096 then `record_evidence_package` (same as post-`register_seed_reference` orchestration)
- [ ] Ready log includes new tool
- [ ] Smoke/listTools test update
- [ ] Commit: `feat: MCP list_pending_seed_evidence for UI seed capture`

---

### Task 3: Workbench hint + e2e bridge

**Files:** workbench UI (minimal hint when awaiting), e2e

- [ ] When projection is awaiting evidence, optional subtle status text in media or folder chrome: waiting for Agent evidence capture (purple-frame language; no Design-issue invention)
- [ ] E2E: UI or HTTP seed → pending list non-empty → record evidence → pending empty + screenshot
- [ ] Commit: `feat: surface pending Agent evidence capture after UI seed entry`

---

### Task 4: Docs

**Files:** `docs/manual-agent-smoke-issue05.md` (and brief Issue 05 note if needed)

- [x] Document UI plus → awaiting → Agent `list_pending_seed_evidence` → 4096 → record
- [x] Commit: `docs: document UI-initiated pending seed evidence capture`

---

## Out of scope

- Runtime calling Figma
- Editing `workflow/`
- Pushing MCP notifications into Agent mid-turn without poll (host limitation)
