# Issue 05 Agent-Host Figma Evidence Declaration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent host ingests Figma seed evidence via its own Figma MCP, declares a minimal structured package through `record_evidence_package`, and Runtime validates schema, creates a Figma Evidence Surface record, and projects it (with screenshot when available) into the tldraw Workbench — with zero Runtime Figma network contact.

**Architecture:** Mirror `register_seed_reference`: pure handler in `lib/runtime/` → HTTP route → thin MCP proxy in `bin/ikran-mcp.mjs`. `record_evidence_package` both validates the package and creates the Figma Evidence Surface record in one call (do not split `create_evidence_surface` in this slice). Screenshots are Agent-supplied (prefer project-relative artifact path; optional small data URL with size cap). Missing evidence views use explicit `"available" | "missing"` — never guessed. Workbench continues GET + poll for broadcast.

**Tech Stack:** Next.js Runtime, Node `node:sqlite`, Zod (or hand validation matching seed-reference style), MCP stdio (`bin/ikran-mcp.mjs`), tldraw custom shapes, Playwright e2e.

**Workspace:** Implement on current repo root (`/Users/bingyizhang/Desktop/recursive-design-agent`), branch `main` (or a feature branch if controller creates one). **Do not create a git worktree.**

**Commit policy:** Commit after each task when the controller asks; do not push unless asked.

---

## File map

| File | Responsibility |
|------|----------------|
| `lib/runtime/evidence-package.ts` | Types, schema validation, `recordEvidencePackage`, `listFigmaEvidenceSurfaces` |
| `lib/runtime/db.ts` | Add `figma_evidence_surfaces` table |
| `lib/runtime/events.ts` | Add `evidence_package_recorded` (and reuse `invalid_output`) |
| `app/api/evidence-package/route.ts` | GET list + POST declare |
| `bin/ikran-mcp.mjs` | Register `record_evidence_package` tool |
| `components/workbench/use-figma-evidence-surfaces.ts` | Poll GET for surfaces |
| `components/workbench/seed-reference-projection-shape.tsx` (or new surface shape) | Render screenshot / frameName / missing state |
| `components/workbench/workbench-canvas.tsx` | Project Evidence Surface records |
| `tests/evidence-package-unit.spec.ts` | Schema valid/invalid + no half-write |
| `tests/evidence-package-mcp.spec.ts` | MCP e2e + Runtime never hits Figma |
| `docs/manual-agent-smoke-issue05.md` | Real Agent + Figma MCP smoke + open gaps |

---

## Locked design decisions

1. **Minimal package fields:**
   - `figmaSeedReference` (string, same local URL rules as seed-reference) OR `seedReferenceId` (existing `seed_references.id`)
   - Prefer requiring `seedReferenceId` when a seed is already registered; if only URL is provided, still accept but link/create surface against that URL string stored on the surface.
   - `frame`: `{ nodeId: string, name: string, bounds?: { x, y, width, height } }` — bounds optional but recommended; coordinate space = Figma absolute (document for Issue 06).
   - `evidenceViews`: `{ rawData: "available" | "missing", screenshot: "available" | "missing" }`
   - `screenshot` optional object: `{ artifactPath?: string, dataUrl?: string }` — required when `evidenceViews.screenshot === "available"`; must be absent or ignored when `missing`. Prefer `artifactPath` (project-relative, must stay under project root). If `dataUrl`, enforce max length (e.g. 2_000_000 chars) with reason `screenshot_too_large`.
   - `designSignals` optional array of `{ id: string, label: string, evidence: string }` (cap length, e.g. ≤ 20).
   - `surfaceBounds` optional `{ width: number, height: number }` for canvas aspect; fall back to `frame.bounds` or default projection size.

2. **One tool creates surface:** `record_evidence_package` → validate → INSERT `figma_evidence_surfaces` → best-effort `evidence_package_recorded` event. On schema failure: `invalid_output` event + structured error, **no** surface row.

3. **Runtime zero Figma:** no fetch/oEmbed/API to figma.com anywhere in this path.

4. **Projection:** Upgrade existing seed-reference projection media when a surface exists for that seed, OR add a dedicated surface projection keyed by surface id. Prefer: keep seed-reference shape for seed-only state; when Evidence Surface exists, update/create projection with `frameName`, screenshot in media, and `meta.kind = "figma_evidence_surface"` + surface id. Do not dual-write semantic fields into tldraw as source of truth.

5. **Issue 06 prep:** Surface record must expose stable `id`, link to seed (`seed_reference_id` nullable or required if id provided), `frame_node_id`, optional bounds JSON.

---

### Task 1: Minimal evidence package schema + unit tests

**Files:**
- Create: `lib/runtime/evidence-package.ts` (types + `validateEvidencePackage` only; no DB yet if cleaner — or stub record fn later)
- Create: `tests/evidence-package-unit.spec.ts`
- Modify: none required yet beyond exports

- [ ] **Step 1:** Write failing unit tests for:
  - valid minimal package (raw available, screenshot missing, no screenshot payload)
  - valid with screenshot `artifactPath`
  - invalid: screenshot available but no payload
  - invalid: bad figma URL / missing frame.nodeId
  - invalid: dataUrl too large
  - explicit missing markers accepted (do not invent content)

- [ ] **Step 2:** Implement `validateEvidencePackage(input)` returning `{ ok: true, package }` or `{ ok: false, reason, details? }`.

- [ ] **Step 3:** Run `npx playwright test tests/evidence-package-unit.spec.ts` (or project’s unit runner if different — prefer same Playwright pattern as other lib tests; if unit tests are plain node, use whatever the repo already uses for non-e2e — check `package.json` scripts / existing `tests/*unit*`).

- [ ] **Step 4:** Commit: `feat: add minimal evidence package schema validation`

---

### Task 2: DB table + `recordEvidencePackage` + `invalid_output`

**Files:**
- Modify: `lib/runtime/db.ts` — add `figma_evidence_surfaces` table
- Modify: `lib/runtime/events.ts` — add `evidence_package_recorded`
- Modify: `lib/runtime/evidence-package.ts` — `recordEvidencePackage`, `listFigmaEvidenceSurfaces`
- Modify: `tests/evidence-package-unit.spec.ts` — record success / fail-closed / invalid_output

**Table sketch:**
```sql
CREATE TABLE IF NOT EXISTS figma_evidence_surfaces (
  id TEXT PRIMARY KEY,
  seed_reference_id TEXT,                 -- nullable FK-like to seed_references.id
  figma_seed_reference TEXT NOT NULL,     -- verbatim URL
  frame_node_id TEXT NOT NULL,
  frame_name TEXT NOT NULL,
  frame_bounds_json TEXT,                 -- nullable JSON
  evidence_views_json TEXT NOT NULL,      -- { rawData, screenshot }
  screenshot_artifact_path TEXT,          -- nullable
  screenshot_data_url TEXT,               -- nullable (discouraged)
  design_signals_json TEXT,               -- nullable JSON array
  surface_bounds_json TEXT,               -- nullable JSON
  created_at TEXT NOT NULL
);
```

- [ ] **Step 1:** Extend unit tests for record path (temp project dir + `initializeProjectDb`).
- [ ] **Step 2:** Implement insert + list; on validation failure call `logEvent(..., "invalid_output", ...)` and return error **without** insert.
- [ ] **Step 3:** On success insert then best-effort `evidence_package_recorded` (same record-first / audit-second pattern as `seed-reference.ts`).
- [ ] **Step 4:** Commit: `feat: persist Figma Evidence Surface from evidence package`

---

### Task 3: HTTP API + MCP `record_evidence_package`

**Files:**
- Create: `app/api/evidence-package/route.ts`
- Modify: `bin/ikran-mcp.mjs`
- Create: `tests/evidence-package-mcp.spec.ts` (skeleton or full in Task 5 — at least MCP tool registration + one success if feasible)

- [ ] **Step 1:** POST/GET mirror `app/api/seed-reference/route.ts` (auth, active project, structured errors).
- [ ] **Step 2:** Register MCP tool with Zod inputSchema matching package fields; proxy to POST; surface 404 stale-runtime like seed tool.
- [ ] **Step 3:** Update MCP ready log / server description to mention the new tool.
- [ ] **Step 4:** Commit: `feat: expose record_evidence_package via HTTP and MCP`

---

### Task 4: Workbench Evidence Surface projection

**Files:**
- Create: `components/workbench/use-figma-evidence-surfaces.ts` (poll GET `/api/evidence-package`)
- Modify: `components/workbench/workbench-canvas.tsx`, `SeedEvidenceWorkbench.tsx`, projection shape / CSS as needed
- Modify: `components/workbench/seed-reference-projection-shape.tsx` — fill media when screenshot present; show frame name; optional missing-evidence affordance (minimal, no Design-issue inventing)

- [ ] **Step 1:** Hook polls surfaces; canvas syncs shapes from Runtime records (one-way).
- [ ] **Step 2:** Render screenshot from `artifactPath` (served how? Prefer data URL stored only for tiny fixtures in tests; for artifactPath use a project-relative URL the Workbench can load — if no static file server exists, for MVP allow dataUrl in package for UI, or add a tiny authenticated GET for artifact bytes under project root. **Choose simplest path that keeps Runtime zero-Figma:** if artifact serving is heavy, document that MVP UI uses `screenshot_data_url` when present and `artifactPath` is stored for later; still validate path stays in project.)
- [ ] **Step 3:** Manual/dev sanity: register seed → record package with dataUrl fixture → media shows image.
- [ ] **Step 4:** Commit: `feat: project Figma Evidence Surface screenshots in tldraw`

---

### Task 5: E2E coverage (valid / invalid / no Figma network)

**Files:**
- Modify/complete: `tests/evidence-package-mcp.spec.ts`
- Optionally extend: `tests/seed-evidence-workbench.spec.ts`

- [ ] **Step 1:** MCP success: tool → DB surface row → `evidence_package_recorded`.
- [ ] **Step 2:** MCP invalid: structured error + `invalid_output` + no surface row.
- [ ] **Step 3:** Assert no requests to `figma.com` / oEmbed / `/api/figma/*` during the flow (route interception like existing workbench tests).
- [ ] **Step 4:** Commit: `test: cover evidence package MCP valid, invalid, zero Figma contact`

---

### Task 6: Real Agent smoke checklist + open gaps

**Files:**
- Create: `docs/manual-agent-smoke-issue05.md`
- Optionally update: `Issues 02/05-agent-host-figma-evidence-declaration.md` checkboxes only if smoke actually run (do not fake-check Real Agent items)

- [ ] **Step 1:** Document steps: open workbench → register seed → Agent uses Figma MCP → `record_evidence_package` → surface appears.
- [ ] **Step 2:** Gap taxonomy: `blocked by Figma access` | `blocked by schema` | `blocked by host MCP tool discovery` | `blocked by IKRAN_STATE_DIR mismatch`.
- [ ] **Step 3:** Commit: `docs: add Issue 05 real Agent smoke checklist`

---

## Out of scope (do not implement)

- Region annotations / Question cards (Issue 06+)
- Runtime Figma fetch
- Separate `create_evidence_surface` MCP tool
- Repair loop / `repaired_output` (Issue 13)
- Design-issue D0x UI invention beyond filling existing placeholder media
