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
// clicks) are stored as the validated raw rect (`geometry_version = v2_raw`).
// Page-isotropic padding is applied at Workbench display time — see
// `region-annotation-display.ts`. Legacy rows (`v1_padded`) already include
// create-time padding and must not be padded again.
//
// Anchor: at least one of `surfaceArtifactId` (figma_evidence_surfaces.id) or
// `surfaceNodeId` (Figma frame_node_id). Resolution:
// - artifact id → must exist; if node id also given, frame_node_id must match
// - node id only → exactly one *current tip* surface with that frame_node_id
//   (joined via seed_references.current_surface_id); historical superseded
//   rows are ignored. 0 tips → surface_not_found; >1 tips → surface_ambiguous
//   (fail closed)
//
// Author defaults for type: designer → explanatory; agent → assumption.
//
// Record + `annotation_created` are written atomically. Event write failure
// rolls back the annotation row and returns `ok: false` / `db_error`.

import { randomUUID } from "node:crypto";
import path from "node:path";
import { openProjectDb, closeProjectDb, withProjectTransaction } from "./db";
import { emitRecordEvent } from "./record-bus";
import { logEventOnDb } from "./events";
import type {
  RegionAnnotationGeometryVersion
} from "./region-annotation-display";

/** Normalized side length for point-click → tiny square (coordinate space A). */
export const POINT_SIDE = 0.02;

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
  /** Resolved figma_evidence_surfaces.id (NOT NULL after schema v4). */
  surface_id: string;
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
  geometry_version: RegionAnnotationGeometryVersion;
  from_point: boolean;
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
  /** Canonical audit event id (always a string on success). */
  event_id: string;
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
   * comfort margin is skipped for these tiny markers at display time.
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
          `SELECT id, frame_node_id FROM figma_evidence_surfaces WHERE id = ?`
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

    // node id only — restrict to current tip surfaces (seed.current_surface_id),
    // not all historical rows for the frame. Fail closed on 0 or >1 tip matches.
    const rows = db
      .prepare(
        `SELECT fes.id, fes.frame_node_id
         FROM figma_evidence_surfaces fes
         INNER JOIN seed_references sr ON sr.current_surface_id = fes.id
         WHERE fes.frame_node_id = ?`
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

function mapAnnotationRow(row: Record<string, unknown>): RegionAnnotationRecord {
  const geometryRaw = row.geometry_version;
  const geometry_version: RegionAnnotationGeometryVersion =
    geometryRaw === "v1_padded" ? "v1_padded" : "v2_raw";
  return {
    id: String(row.id),
    surface_id: String(row.surface_id),
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
    created_at: String(row.created_at),
    geometry_version,
    from_point: Number(row.from_point) === 1
  };
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

  // Store validated raw rect; Agent padding is display-time only (v2_raw).
  const rect = normalized.rect;

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
    created_at: new Date().toISOString(),
    geometry_version: "v2_raw",
    from_point: normalized.fromPoint
  };

  try {
    const event = withProjectTransaction(projectPath, (db) => {
      db.prepare(
        `INSERT INTO region_annotations (
          id, surface_id, surface_artifact_id, surface_node_id,
          author, type, body,
          rect_x, rect_y, rect_w, rect_h,
          primary_node_id, candidates_json, created_at,
          geometry_version, from_point
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
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
        record.created_at,
        record.geometry_version,
        record.from_point ? 1 : 0
      );
      return logEventOnDb(db, "annotation_created", {
        annotation_id: record.id,
        surface_id: record.surface_id,
        surface_artifact_id: record.surface_artifact_id,
        surface_node_id: record.surface_node_id,
        author: record.author,
        type: record.type
      });
    });
    emitRecordEvent({
      kind: "annotation",
      action: "created",
      id: record.id,
      projectPath: path.resolve(projectPath)
    });
    return { ok: true, record, event_id: event.event_id };
  } catch {
    return { ok: false, reason: "db_error" };
  }
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
    emitRecordEvent({
      kind: "annotation",
      action: "deleted",
      id,
      projectPath: path.resolve(projectPath)
    });
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
    return rows.map(mapAnnotationRow);
  } finally {
    closeProjectDb(db);
  }
}
