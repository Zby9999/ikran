// Region Annotation persistence (Issue 06 Runtime foundation).
//
// Records an anchored annotation on a Figma Evidence Surface. Coordinate space
// **A**: normalized rect relative to the Evidence Surface screenshot media box
// (0–1). Values outside [0,1] are rejected (not silently clamped) for explicit
// rects; point-clicks expand to a tiny square then are edge-shifted to stay in
// bounds (see POINT_SIDE / expandPointToRect).
//
// Point-click rule: when `point` is provided (or rect has zero width & height),
// expand to a square of side POINT_SIDE (0.02) **centered on the click**, then
// shift into [0, 1−POINT_SIDE] so the full square stays on the media box.
//
// Agent region comfort margin: Agent-authored **explicit** rects (not point-
// clicks) are expanded by a **page-isotropic** padding derived from
// AGENT_REGION_MARGIN (fraction of media width) so left/right and top/bottom
// gaps match in page pixels on tall/wide screenshots. Applied at create time
// using surface frame/surface bounds when available; then clamped to the media
// box. Designer rects are stored as drawn (no auto-margin).
//
// Anchor: at least one of `surfaceArtifactId` (figma_evidence_surfaces.id) or
// `surfaceNodeId` (Figma frame_node_id). Resolution:
// - artifact id → must exist; if node id also given, frame_node_id must match
// - node id only → exactly one surface with that frame_node_id; 0 →
//   surface_not_found; >1 → surface_ambiguous (fail closed)
//
// Author defaults for type: designer → explanatory; agent → assumption.
//
// Record vs event: the `region_annotations` row is SOURCE OF TRUTH;
// `annotation_created` is a best-effort AUDIT log (same pattern as
// seed-reference / evidence-package).

import { randomUUID } from "node:crypto";
import { openSync, readSync, closeSync, existsSync } from "node:fs";
import { openProjectDb, closeProjectDb } from "./db";
import { logEvent } from "./events";
import { resolveProjectArtifactPath } from "./evidence-package";

/** Normalized side length for point-click → tiny square (coordinate space A). */
export const POINT_SIDE = 0.02;

/**
 * Horizontal comfort padding as a fraction of media **width**. Vertical
 * padding is derived so page-pixel gaps match (`my = mx * mediaW / mediaH`).
 * Equal normalized sides on a tall frame made top/bottom look much larger.
 */
export const AGENT_REGION_MARGIN = 0.012;

/** Optional media box size (any positive units) for isotropic page padding. */
export interface AgentRegionMediaSize {
  w: number;
  h: number;
}

export type RegionAnnotationAuthor = "designer" | "agent";

export type RegionAnnotationType =
  | "question"
  | "assumption"
  | "observed_fact"
  | "generalization_risk"
  | "explanatory";

/** Normalized rect in coordinate space A (screenshot media box, 0–1). */
export interface RegionAnnotationRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Point-click in coordinate space A; expanded to POINT_SIDE square centered. */
export interface RegionAnnotationPoint {
  x: number;
  y: number;
}

export interface RegionAnnotationInput {
  /** figma_evidence_surfaces.id — preferred when known. */
  surfaceArtifactId?: string;
  /** Figma frame_node_id string. */
  surfaceNodeId?: string;
  author: RegionAnnotationAuthor;
  /** Defaults: designer → explanatory; agent → assumption. */
  type?: RegionAnnotationType;
  /** Free text; placeholder strings allowed (e.g. "Placeholder annotation"). */
  body: string;
  /**
   * Explicit normalized rect. Rejected if any component is outside [0,1],
   * non-finite, or (after validation) has zero area — unless both w and h are
   * 0, which is treated as a point-click at (x, y).
   */
  rect?: RegionAnnotationRect;
  /** Point-click; mutually preferred over zero-area rect expansion. */
  point?: RegionAnnotationPoint;
  /** Optional Agent single-node primary Figma node id. */
  primaryNodeId?: string;
  /** Optional Agent candidate list (stored as JSON). */
  candidates?: unknown[];
}

export interface RegionAnnotationRecord {
  id: string;
  /** Resolved figma_evidence_surfaces.id when known. */
  surface_id: string | null;
  surface_artifact_id: string | null;
  surface_node_id: string | null;
  author: RegionAnnotationAuthor;
  type: RegionAnnotationType;
  body: string;
  rect_x: number;
  rect_y: number;
  rect_w: number;
  rect_h: number;
  primary_node_id: string | null;
  candidates_json: string | null;
  created_at: string;
}

export type RegionAnnotationValidationReason =
  | "missing_surface_anchor"
  | "missing_author"
  | "invalid_author"
  | "invalid_type"
  | "missing_body"
  | "missing_rect"
  | "invalid_rect"
  | "invalid_point"
  | "invalid_primary_node_id"
  | "invalid_candidates";

export type RegionAnnotationErrorReason =
  | RegionAnnotationValidationReason
  | "surface_not_found"
  | "surface_ambiguous"
  | "surface_node_mismatch"
  | "db_error";

export interface RegionAnnotationResult {
  ok: true;
  record: RegionAnnotationRecord;
  /** Audit event id, or null when the best-effort audit write failed. */
  event_id: string | null;
  /** Present iff the best-effort audit event could not be written. */
  audit_warning?: "event_write_failed";
}

export interface RegionAnnotationError {
  ok: false;
  reason: RegionAnnotationErrorReason;
}

export type RegionAnnotationResponse =
  | RegionAnnotationResult
  | RegionAnnotationError;

const AUTHORS = new Set<RegionAnnotationAuthor>(["designer", "agent"]);
const TYPES = new Set<RegionAnnotationType>([
  "question",
  "assumption",
  "observed_fact",
  "generalization_risk",
  "explanatory"
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** True iff every component is a finite number in [0, 1]. */
function isUnitInterval(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

/**
 * Expand a point-click to a POINT_SIDE square centered on the click, then
 * shift so the square stays fully inside [0,1]×[0,1].
 */
export function expandPointToRect(
  point: RegionAnnotationPoint
): RegionAnnotationRect {
  const half = POINT_SIDE / 2;
  let x = point.x - half;
  let y = point.y - half;
  const maxOrigin = 1 - POINT_SIDE;
  x = Math.min(Math.max(0, x), maxOrigin);
  y = Math.min(Math.max(0, y), maxOrigin);
  return { x, y, w: POINT_SIDE, h: POINT_SIDE };
}

/**
 * Expand an Agent region rect with page-isotropic comfort padding, then clamp
 * to the unit media box.
 *
 * `AGENT_REGION_MARGIN` is the normalized **horizontal** inset (fraction of
 * media width). When `mediaSize` is provided, vertical inset is
 * `margin * mediaW / mediaH` so top/bottom page pixels match left/right.
 * Without media size, falls back to equal normalized insets (legacy).
 */
export function expandAgentRegionRect(
  rect: RegionAnnotationRect,
  mediaSize?: AgentRegionMediaSize
): RegionAnnotationRect {
  const mx = AGENT_REGION_MARGIN;
  let my = AGENT_REGION_MARGIN;
  if (mediaSize && mediaSize.w > 0 && mediaSize.h > 0) {
    my = (mx * mediaSize.w) / mediaSize.h;
  }
  const left = Math.max(0, rect.x - mx);
  const top = Math.max(0, rect.y - my);
  const right = Math.min(1, rect.x + rect.w + mx);
  const bottom = Math.min(1, rect.y + rect.h + my);
  return {
    x: left,
    y: top,
    w: Math.max(0, right - left),
    h: Math.max(0, bottom - top)
  };
}

function defaultTypeForAuthor(
  author: RegionAnnotationAuthor
): RegionAnnotationType {
  return author === "designer" ? "explanatory" : "assumption";
}

export interface NormalizedRegionAnnotationInput {
  surfaceArtifactId?: string;
  surfaceNodeId?: string;
  author: RegionAnnotationAuthor;
  type: RegionAnnotationType;
  body: string;
  rect: RegionAnnotationRect;
  /**
   * True when geometry came from a point-click (or zero-area rect). Agent
   * comfort margin is skipped for these tiny markers.
   */
  fromPoint: boolean;
  primaryNodeId?: string;
  candidates?: unknown[];
}

export type RegionAnnotationValidationResult =
  | { ok: true; input: NormalizedRegionAnnotationInput }
  | { ok: false; reason: RegionAnnotationValidationReason };

/**
 * Local format validation only — does not touch the DB / resolve surfaces.
 */
export function validateRegionAnnotationInput(
  input: unknown
): RegionAnnotationValidationResult {
  if (input === null || typeof input !== "object") {
    return { ok: false, reason: "missing_surface_anchor" };
  }
  const raw = input as Record<string, unknown>;

  const artifactRaw = raw.surfaceArtifactId;
  const nodeRaw = raw.surfaceNodeId;
  const hasArtifact = isNonEmptyString(artifactRaw);
  const hasNode = isNonEmptyString(nodeRaw);
  if (!hasArtifact && !hasNode) {
    return { ok: false, reason: "missing_surface_anchor" };
  }

  if (raw.author === undefined || raw.author === null || raw.author === "") {
    return { ok: false, reason: "missing_author" };
  }
  if (typeof raw.author !== "string" || !AUTHORS.has(raw.author as RegionAnnotationAuthor)) {
    return { ok: false, reason: "invalid_author" };
  }
  const author = raw.author as RegionAnnotationAuthor;

  let type: RegionAnnotationType;
  if (raw.type === undefined || raw.type === null) {
    type = defaultTypeForAuthor(author);
  } else if (
    typeof raw.type !== "string" ||
    !TYPES.has(raw.type as RegionAnnotationType)
  ) {
    return { ok: false, reason: "invalid_type" };
  } else {
    type = raw.type as RegionAnnotationType;
  }

  if (!isNonEmptyString(raw.body)) {
    return { ok: false, reason: "missing_body" };
  }
  const body = raw.body.trim();

  // --- geometry: point and/or rect ---
  let rect: RegionAnnotationRect | null = null;
  let fromPoint = false;

  const pointRaw = raw.point;
  if (pointRaw !== undefined && pointRaw !== null) {
    if (typeof pointRaw !== "object") {
      return { ok: false, reason: "invalid_point" };
    }
    const p = pointRaw as Record<string, unknown>;
    if (!isUnitInterval(p.x) || !isUnitInterval(p.y)) {
      return { ok: false, reason: "invalid_point" };
    }
    rect = expandPointToRect({ x: p.x, y: p.y });
    fromPoint = true;
  }

  const rectRaw = raw.rect;
  if (rect === null) {
    if (rectRaw === undefined || rectRaw === null) {
      return { ok: false, reason: "missing_rect" };
    }
    if (typeof rectRaw !== "object") {
      return { ok: false, reason: "invalid_rect" };
    }
    const r = rectRaw as Record<string, unknown>;
    if (
      !isUnitInterval(r.x) ||
      !isUnitInterval(r.y) ||
      !isUnitInterval(r.w) ||
      !isUnitInterval(r.h)
    ) {
      return { ok: false, reason: "invalid_rect" };
    }
    // Zero-area rect → treat as point-click at (x, y).
    if (r.w === 0 && r.h === 0) {
      rect = expandPointToRect({ x: r.x, y: r.y });
      fromPoint = true;
    } else if (r.w <= 0 || r.h <= 0) {
      return { ok: false, reason: "invalid_rect" };
    } else if (r.x + r.w > 1 + 1e-12 || r.y + r.h > 1 + 1e-12) {
      // Rect must lie fully inside the media box (no overflow past 1).
      return { ok: false, reason: "invalid_rect" };
    } else {
      rect = { x: r.x, y: r.y, w: r.w, h: r.h };
    }
  }

  let primaryNodeId: string | undefined;
  if (raw.primaryNodeId !== undefined && raw.primaryNodeId !== null) {
    if (!isNonEmptyString(raw.primaryNodeId)) {
      return { ok: false, reason: "invalid_primary_node_id" };
    }
    primaryNodeId = raw.primaryNodeId.trim();
  }

  let candidates: unknown[] | undefined;
  if (raw.candidates !== undefined && raw.candidates !== null) {
    if (!Array.isArray(raw.candidates)) {
      return { ok: false, reason: "invalid_candidates" };
    }
    candidates = raw.candidates;
  }

  const normalized: NormalizedRegionAnnotationInput = {
    author,
    type,
    body,
    rect: rect!,
    fromPoint
  };
  if (hasArtifact) normalized.surfaceArtifactId = artifactRaw.trim();
  if (hasNode) normalized.surfaceNodeId = nodeRaw.trim();
  if (primaryNodeId !== undefined) normalized.primaryNodeId = primaryNodeId;
  if (candidates !== undefined) normalized.candidates = candidates;

  return { ok: true, input: normalized };
}

interface SurfaceRow {
  id: string;
  frame_node_id: string;
  frame_bounds_json: string | null;
  surface_bounds_json: string | null;
  screenshot_artifact_path: string | null;
  screenshot_data_url: string | null;
}

/** Parse positive w/h from frame_bounds or surface_bounds JSON when present. */
export function mediaSizeFromSurfaceBounds(
  frameBoundsJson: string | null | undefined,
  surfaceBoundsJson: string | null | undefined
): AgentRegionMediaSize | undefined {
  for (const raw of [frameBoundsJson, surfaceBoundsJson]) {
    if (!raw || typeof raw !== "string") continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const w = parsed.width;
      const h = parsed.height;
      if (
        typeof w === "number" &&
        typeof h === "number" &&
        Number.isFinite(w) &&
        Number.isFinite(h) &&
        w > 0 &&
        h > 0
      ) {
        return { w, h };
      }
    } catch {
      // ignore malformed JSON
    }
  }
  return undefined;
}

/**
 * Read PNG/JPEG pixel size from a buffer (header only). Used when surface
 * bounds are missing so Agent margin can still be page-isotropic.
 */
export function mediaSizeFromImageBuffer(
  buf: Buffer
): AgentRegionMediaSize | undefined {
  if (buf.length < 24) return undefined;
  // PNG: 8-byte signature + IHDR length/type + width/height
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    if (buf.toString("ascii", 12, 16) !== "IHDR") return undefined;
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    if (w > 0 && h > 0) return { w, h };
    return undefined;
  }
  // JPEG: scan for SOF0/SOF2 marker
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) break;
      // SOF0 / SOF2 (baseline / progressive)
      if (marker === 0xc0 || marker === 0xc2) {
        const h = buf.readUInt16BE(i + 5);
        const w = buf.readUInt16BE(i + 7);
        if (w > 0 && h > 0) return { w, h };
        return undefined;
      }
      i += 2 + len;
    }
  }
  return undefined;
}

export function mediaSizeFromScreenshotDataUrl(
  dataUrl: string | null | undefined
): AgentRegionMediaSize | undefined {
  if (!dataUrl || typeof dataUrl !== "string") return undefined;
  const m = /^data:image\/(?:png|jpeg|jpg);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return undefined;
  try {
    return mediaSizeFromImageBuffer(Buffer.from(m[1], "base64"));
  } catch {
    return undefined;
  }
}

/**
 * Prefer declared frame/surface bounds; fall back to screenshot pixel size.
 */
export function resolveAgentRegionMediaSize(
  projectPath: string,
  surface: Pick<
    SurfaceRow,
    | "frame_bounds_json"
    | "surface_bounds_json"
    | "screenshot_artifact_path"
    | "screenshot_data_url"
  >
): AgentRegionMediaSize | undefined {
  const fromBounds = mediaSizeFromSurfaceBounds(
    surface.frame_bounds_json,
    surface.surface_bounds_json
  );
  if (fromBounds) return fromBounds;

  const fromDataUrl = mediaSizeFromScreenshotDataUrl(
    surface.screenshot_data_url
  );
  if (fromDataUrl) return fromDataUrl;

  if (surface.screenshot_artifact_path) {
    const abs = resolveProjectArtifactPath(
      projectPath,
      surface.screenshot_artifact_path
    );
    if (abs && existsSync(abs)) {
      try {
        // Header only — first 64KB is enough for PNG IHDR / JPEG SOF.
        const fd = openSync(abs, "r");
        try {
          const buf = Buffer.alloc(65536);
          const n = readSync(fd, buf, 0, 65536, 0);
          return mediaSizeFromImageBuffer(buf.subarray(0, n));
        } finally {
          closeSync(fd);
        }
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function resolveSurfaceAnchor(
  projectPath: string,
  surfaceArtifactId: string | undefined,
  surfaceNodeId: string | undefined
):
  | { ok: true; surface: SurfaceRow }
  | { ok: false; reason: "surface_not_found" | "surface_ambiguous" | "surface_node_mismatch" } {
  const db = openProjectDb(projectPath);
  try {
    if (surfaceArtifactId) {
      const row = db
        .prepare(
          `SELECT id, frame_node_id, frame_bounds_json, surface_bounds_json,
                  screenshot_artifact_path, screenshot_data_url
           FROM figma_evidence_surfaces WHERE id = ?`
        )
        .get(surfaceArtifactId) as unknown as SurfaceRow | undefined;
      if (!row) {
        return { ok: false, reason: "surface_not_found" };
      }
      if (surfaceNodeId && row.frame_node_id !== surfaceNodeId) {
        return { ok: false, reason: "surface_node_mismatch" };
      }
      return { ok: true, surface: row };
    }

    // node id only — fail closed on 0 or >1 matches
    const rows = db
      .prepare(
        `SELECT id, frame_node_id, frame_bounds_json, surface_bounds_json,
                screenshot_artifact_path, screenshot_data_url
         FROM figma_evidence_surfaces WHERE frame_node_id = ?`
      )
      .all(surfaceNodeId!) as unknown as SurfaceRow[];
    if (rows.length === 0) {
      return { ok: false, reason: "surface_not_found" };
    }
    if (rows.length > 1) {
      return { ok: false, reason: "surface_ambiguous" };
    }
    return { ok: true, surface: rows[0] };
  } finally {
    closeProjectDb(db);
  }
}

export function createRegionAnnotation(
  projectPath: string,
  input: unknown
): RegionAnnotationResponse {
  const validated = validateRegionAnnotationInput(input);
  if (!validated.ok) {
    return { ok: false, reason: validated.reason };
  }
  const normalized = validated.input;

  const resolved = resolveSurfaceAnchor(
    projectPath,
    normalized.surfaceArtifactId,
    normalized.surfaceNodeId
  );
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }

  const surface = resolved.surface;
  const surfaceArtifactId = normalized.surfaceArtifactId ?? surface.id;
  const surfaceNodeId = normalized.surfaceNodeId ?? surface.frame_node_id;

  // Agent explicit regions: page-isotropic comfort margin using surface aspect.
  let rect = normalized.rect;
  if (normalized.author === "agent" && !normalized.fromPoint) {
    const mediaSize = resolveAgentRegionMediaSize(projectPath, surface);
    rect = expandAgentRegionRect(rect, mediaSize);
  }

  const record: RegionAnnotationRecord = {
    id: randomUUID(),
    surface_id: surface.id,
    surface_artifact_id: surfaceArtifactId,
    surface_node_id: surfaceNodeId,
    author: normalized.author,
    type: normalized.type,
    body: normalized.body,
    rect_x: rect.x,
    rect_y: rect.y,
    rect_w: rect.w,
    rect_h: rect.h,
    primary_node_id: normalized.primaryNodeId ?? null,
    candidates_json:
      normalized.candidates !== undefined
        ? JSON.stringify(normalized.candidates)
        : null,
    created_at: new Date().toISOString()
  };

  const db = openProjectDb(projectPath);
  try {
    const stmt = db.prepare(
      `INSERT INTO region_annotations (
        id, surface_id, surface_artifact_id, surface_node_id,
        author, type, body,
        rect_x, rect_y, rect_w, rect_h,
        primary_node_id, candidates_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      record.id,
      record.surface_id,
      record.surface_artifact_id,
      record.surface_node_id,
      record.author,
      record.type,
      record.body,
      record.rect_x,
      record.rect_y,
      record.rect_w,
      record.rect_h,
      record.primary_node_id,
      record.candidates_json,
      record.created_at
    );
  } catch {
    return { ok: false, reason: "db_error" };
  } finally {
    closeProjectDb(db);
  }

  let event_id: string | null = null;
  let audit_warning: "event_write_failed" | undefined;
  try {
    const event = logEvent(projectPath, "annotation_created", {
      annotation_id: record.id,
      surface_id: record.surface_id,
      surface_artifact_id: record.surface_artifact_id,
      surface_node_id: record.surface_node_id,
      author: record.author,
      type: record.type
    });
    event_id = event.event_id;
  } catch {
    audit_warning = "event_write_failed";
  }

  const result: RegionAnnotationResult = { ok: true, record, event_id };
  if (audit_warning) result.audit_warning = audit_warning;
  return result;
}

export type RegionAnnotationDeleteReason =
  | "not_found"
  | "not_deletable"
  | "db_error";

export type RegionAnnotationDeleteResponse =
  | { ok: true; id: string }
  | { ok: false; reason: RegionAnnotationDeleteReason };

/**
 * Delete a Region Annotation by id.
 * Product rule: only `author === "designer"` rows may be deleted.
 * Agent (grey) markers are never deletable from the Workbench.
 */
export function deleteRegionAnnotation(
  projectPath: string,
  annotationId: string
): RegionAnnotationDeleteResponse {
  if (typeof annotationId !== "string" || annotationId.trim().length === 0) {
    return { ok: false, reason: "not_found" };
  }
  const id = annotationId.trim();
  const db = openProjectDb(projectPath);
  try {
    const row = db
      .prepare("SELECT id, author FROM region_annotations WHERE id = ?")
      .get(id) as { id: string; author: string } | undefined;
    if (!row) {
      return { ok: false, reason: "not_found" };
    }
    if (row.author !== "designer") {
      return { ok: false, reason: "not_deletable" };
    }
    db.prepare("DELETE FROM region_annotations WHERE id = ?").run(id);
    return { ok: true, id };
  } catch {
    return { ok: false, reason: "db_error" };
  } finally {
    closeProjectDb(db);
  }
}

/** Oldest-first — matches listSeedReferences / listFigmaEvidenceSurfaces. */
export function listRegionAnnotations(
  projectPath: string
): RegionAnnotationRecord[] {
  const db = openProjectDb(projectPath);
  try {
    const rows = db
      .prepare("SELECT * FROM region_annotations ORDER BY created_at ASC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      surface_id: row.surface_id == null ? null : String(row.surface_id),
      surface_artifact_id:
        row.surface_artifact_id == null
          ? null
          : String(row.surface_artifact_id),
      surface_node_id:
        row.surface_node_id == null ? null : String(row.surface_node_id),
      author: row.author === "designer" ? "designer" : "agent",
      type: String(row.type) as RegionAnnotationType,
      body: String(row.body),
      rect_x: Number(row.rect_x),
      rect_y: Number(row.rect_y),
      rect_w: Number(row.rect_w),
      rect_h: Number(row.rect_h),
      primary_node_id:
        row.primary_node_id == null ? null : String(row.primary_node_id),
      candidates_json:
        row.candidates_json == null ? null : String(row.candidates_json),
      created_at: String(row.created_at)
    }));
  } finally {
    closeProjectDb(db);
  }
}
