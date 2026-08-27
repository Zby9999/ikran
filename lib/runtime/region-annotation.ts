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
// Author defaults for type: designer → designer_annotation; agent → assumption.
// Designer annotations are bound to one six-part Alignment section; agent
// annotations may carry one. Legacy rows keep `section: null` and legacy
// `explanatory` rows stay readable.
//
// Record + `annotation_created` are written atomically. Event write failure
// rolls back the annotation row and returns `ok: false` / `db_error`.

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import { openProjectDb, closeProjectDb, withProjectTransaction } from "./db";
import { emitRecordEvent } from "./record-bus";
import { logEventOnDb } from "./events";
import {
  ALIGNMENT_SECTIONS,
  type AlignmentSection
} from "./design-intent-alignment";
import { recordCurrentDesignerAnnotationSemanticChangeOnDb } from "./alignment-incremental-planning";
import {
  asEvidenceBounds,
  getAnnotationNodeCandidates,
  intersectEvidenceBounds,
  parsePositionalNodes
} from "./figma-positional-evidence";
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
  | "designer_annotation"
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

export type FigmaRegionAnnotationTarget = {
  kind: "figma-region";
  surfaceArtifactId?: string;
  surfaceNodeId?: string;
  rect?: RegionAnnotationRect;
  point?: RegionAnnotationPoint;
};

export type FigmaSurfaceAnnotationTarget = {
  kind: "figma-surface";
  evidenceVersionId: string;
};

export type FigmaNodeAnnotationTarget = {
  kind: "figma-node";
  evidenceVersionId: string;
  nodeId: string;
};

export type AnnotationTarget =
  | FigmaSurfaceAnnotationTarget
  | FigmaNodeAnnotationTarget
  | FigmaRegionAnnotationTarget;

export interface RegionAnnotationInput {
  target: AnnotationTarget;
  author: RegionAnnotationAuthor;
  /** Defaults: designer → designer_annotation; agent → assumption. */
  type?: RegionAnnotationType;
  /** Free text; placeholder strings allowed (e.g. "Placeholder annotation"). */
  body: string;
  /**
   * One of the six Alignment sections. Required when author is "designer";
   * optional for agent annotations.
   */
  section?: string;
  /**
   * Explicit normalized rect. Rejected if any component is outside [0,1],
   * non-finite, or (after validation) has zero area — unless both w and h are
   * 0, which is treated as a point-click at (x, y).
   */
}

export interface RegionAnnotationRecord {
  id: string;
  /** Resolved figma_evidence_surfaces.id (NOT NULL after schema v4). */
  surface_id: string;
  surface_artifact_id: string | null;
  surface_node_id: string | null;
  target_kind: AnnotationTarget["kind"];
  target_evidence_version_id: string;
  target_node_id: string | null;
  current_evidence_version_id: string | null;
  current_node_id: string | null;
  current_rect_x: number | null;
  current_rect_y: number | null;
  current_rect_w: number | null;
  current_rect_h: number | null;
  correspondence_status: "corresponding" | "missing" | "not_applicable";
  stale: boolean;
  author: RegionAnnotationAuthor;
  type: RegionAnnotationType;
  body: string;
  section: AlignmentSection | null;
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
  | "missing_target"
  | "invalid_target"
  | "missing_surface_anchor"
  | "missing_author"
  | "invalid_author"
  | "invalid_type"
  | "missing_body"
  | "missing_rect"
  | "invalid_rect"
  | "invalid_point"
  | "missing_section"
  | "invalid_section";

export type RegionAnnotationErrorReason =
  | RegionAnnotationValidationReason
  | "surface_not_found"
  | "surface_ambiguous"
  | "surface_node_mismatch"
  | "node_not_found"
  | "evidence_geometry_missing"
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

export interface AnnotationPrimaryConfirmationRecord {
  id: string;
  annotation_id: string;
  evidence_version_id: string;
  source_node_id: string;
  created_at: string;
}

export type AnnotationPrimaryConfirmationResponse =
  | {
      ok: true;
      confirmation: AnnotationPrimaryConfirmationRecord;
      event_id: string;
    }
  | {
      ok: false;
      reason:
        | "invalid_confirmation"
        | "annotation_not_found"
        | "surface_mismatch"
        | "node_not_found"
        | "db_error";
    };

const AUTHORS = new Set<RegionAnnotationAuthor>(["designer", "agent"]);
const TYPES = new Set<RegionAnnotationType>([
  "question",
  "assumption",
  "observed_fact",
  "generalization_risk",
  "designer_annotation",
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
  return author === "designer" ? "designer_annotation" : "assumption";
}

export interface NormalizedRegionAnnotationInput {
  target:
    | FigmaSurfaceAnnotationTarget
    | FigmaNodeAnnotationTarget
    | (FigmaRegionAnnotationTarget & { rect: RegionAnnotationRect });
  surfaceArtifactId?: string;
  surfaceNodeId?: string;
  author: RegionAnnotationAuthor;
  type: RegionAnnotationType;
  body: string;
  section: AlignmentSection | null;
  rect?: RegionAnnotationRect;
  /**
   * True when geometry came from a point-click (or zero-area rect). Agent
   * comfort margin is skipped for these tiny markers at display time.
   */
  fromPoint: boolean;
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

  if (raw.target === undefined || raw.target === null) {
    return { ok: false, reason: "missing_target" };
  }
  if (typeof raw.target !== "object") {
    return { ok: false, reason: "invalid_target" };
  }
  const targetRaw = raw.target as Record<string, unknown>;
  if (
    targetRaw.kind !== "figma-region" &&
    targetRaw.kind !== "figma-surface" &&
    targetRaw.kind !== "figma-node"
  ) {
    return { ok: false, reason: "invalid_target" };
  }

  const isSurfaceTarget = targetRaw.kind === "figma-surface";
  const isNodeTarget = targetRaw.kind === "figma-node";
  if (
    (isSurfaceTarget || isNodeTarget) &&
    !isNonEmptyString(targetRaw.evidenceVersionId)
  ) {
    return { ok: false, reason: "invalid_target" };
  }
  if (isNodeTarget && !isNonEmptyString(targetRaw.nodeId)) {
    return { ok: false, reason: "invalid_target" };
  }

  const artifactRaw = isSurfaceTarget || isNodeTarget
    ? targetRaw.evidenceVersionId
    : targetRaw.surfaceArtifactId;
  const nodeRaw =
    isSurfaceTarget || isNodeTarget ? undefined : targetRaw.surfaceNodeId;
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

  if (isSurfaceTarget) {
    rect = { x: 0, y: 0, w: 1, h: 1 };
  }

  const pointRaw =
    isSurfaceTarget || isNodeTarget ? undefined : targetRaw.point;
  if (rect === null && pointRaw !== undefined && pointRaw !== null) {
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

  const rectRaw =
    isSurfaceTarget || isNodeTarget ? undefined : targetRaw.rect;
  if (rect === null && !isNodeTarget) {
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

  // --- section: six-part Alignment binding (designer-required) ---
  let section: AlignmentSection | null = null;
  if (raw.section !== undefined && raw.section !== null) {
    if (
      typeof raw.section !== "string" ||
      !(ALIGNMENT_SECTIONS as readonly string[]).includes(raw.section)
    ) {
      return { ok: false, reason: "invalid_section" };
    }
    section = raw.section as AlignmentSection;
  }
  if (author === "designer" && section === null) {
    return { ok: false, reason: "missing_section" };
  }

  const normalized: NormalizedRegionAnnotationInput = {
    target: isSurfaceTarget
      ? {
          kind: "figma-surface",
          evidenceVersionId: (artifactRaw as string).trim()
        }
      : isNodeTarget
        ? {
            kind: "figma-node",
            evidenceVersionId: (artifactRaw as string).trim(),
            nodeId: (targetRaw.nodeId as string).trim()
          }
      : {
          kind: "figma-region",
          ...(hasArtifact
            ? { surfaceArtifactId: (artifactRaw as string).trim() }
            : {}),
          ...(hasNode ? { surfaceNodeId: (nodeRaw as string).trim() } : {}),
          rect: rect!
        },
    author,
    type,
    body,
    section,
    ...(rect ? { rect } : {}),
    fromPoint
  };
  if (hasArtifact) normalized.surfaceArtifactId = artifactRaw.trim();
  if (hasNode) normalized.surfaceNodeId = nodeRaw.trim();
  return { ok: true, input: normalized };
}

interface SurfaceRow {
  id: string;
  frame_node_id: string;
  frame_bounds_json: string | null;
  positional_nodes_json: string | null;
  seed_reference_id: string;
}

function normalizedNodeRect(
  frameBoundsJson: string | null,
  positionalNodesJson: string | null,
  nodeId: string
): RegionAnnotationRect | null {
  let frameBoundsValue: unknown = null;
  try {
    frameBoundsValue = frameBoundsJson ? JSON.parse(frameBoundsJson) : null;
  } catch {
    frameBoundsValue = null;
  }
  const frameBounds = asEvidenceBounds(frameBoundsValue);
  if (!frameBounds) return null;
  const node = parsePositionalNodes(positionalNodesJson).find(
    (candidate) =>
      candidate.id === nodeId && candidate.visible && candidate.bounds
  );
  if (!node?.bounds) return null;
  const visibleBounds =
    node.clipRenderBounds === undefined
      ? node.bounds
      : asEvidenceBounds(node.clipRenderBounds);
  if (!visibleBounds) return null;
  const clipped = intersectEvidenceBounds(frameBounds, visibleBounds);
  if (!clipped) return null;
  return {
    x: (clipped.x - frameBounds.x) / frameBounds.width,
    y: (clipped.y - frameBounds.y) / frameBounds.height,
    w: clipped.width / frameBounds.width,
    h: clipped.height / frameBounds.height
  };
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
          `SELECT id, frame_node_id, frame_bounds_json, positional_nodes_json,
                  seed_reference_id
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

    // node id only — restrict to current tip surfaces (seed.current_surface_id),
    // not all historical rows for the frame. Fail closed on 0 or >1 tip matches.
    const rows = db
      .prepare(
        `SELECT fes.id, fes.frame_node_id, fes.frame_bounds_json,
                fes.positional_nodes_json, fes.seed_reference_id
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
  const targetKind =
    row.target_kind === "figma-surface" || row.target_kind === "figma-node"
      ? row.target_kind
      : "figma-region";
  const targetNodeId =
    row.target_node_id == null ? null : String(row.target_node_id);
  const primaryNodeId =
    row.primary_node_id == null ? null : String(row.primary_node_id);
  // A free region has no node identity until an Agent explicitly confirms its
  // primary candidate. From that point on, the confirmation is just as
  // authoritative for refresh correspondence as a native figma-node target.
  const correspondenceNodeId =
    targetKind === "figma-node"
      ? targetNodeId
      : targetKind === "figma-region"
        ? primaryNodeId
        : null;
  const currentEvidenceVersionId =
    row.current_evidence_version_id == null
      ? null
      : String(row.current_evidence_version_id);
  const currentNodes = parsePositionalNodes(
    row.current_positional_nodes_json == null
      ? null
      : String(row.current_positional_nodes_json)
  );
  const currentNode =
    correspondenceNodeId
      ? currentNodes.find((node) => node.id === correspondenceNodeId) ?? null
      : null;
  const currentRect =
    currentNode && correspondenceNodeId
      ? normalizedNodeRect(
          row.current_frame_bounds_json == null
            ? null
            : String(row.current_frame_bounds_json),
          row.current_positional_nodes_json == null
            ? null
            : String(row.current_positional_nodes_json),
          correspondenceNodeId
        )
      : null;
  const correspondenceStatus =
    correspondenceNodeId == null
      ? "not_applicable"
      : currentRect
        ? "corresponding"
        : "missing";
  return {
    id: String(row.id),
    surface_id: String(row.surface_id),
    surface_artifact_id:
      row.surface_artifact_id == null
        ? null
        : String(row.surface_artifact_id),
    surface_node_id:
      row.surface_node_id == null ? null : String(row.surface_node_id),
    target_kind: targetKind,
    target_evidence_version_id: String(
      row.target_evidence_version_id ?? row.surface_id
    ),
    target_node_id: targetNodeId,
    current_evidence_version_id: currentEvidenceVersionId,
    current_node_id: currentRect ? currentNode?.id ?? null : null,
    current_rect_x: currentRect?.x ?? null,
    current_rect_y: currentRect?.y ?? null,
    current_rect_w: currentRect?.w ?? null,
    current_rect_h: currentRect?.h ?? null,
    correspondence_status: correspondenceStatus,
    stale: correspondenceStatus === "missing",
    author: row.author === "designer" ? "designer" : "agent",
    type: String(row.type) as RegionAnnotationType,
    body: String(row.body),
    section:
      typeof row.section === "string" &&
      (ALIGNMENT_SECTIONS as readonly string[]).includes(row.section)
        ? (row.section as AlignmentSection)
        : null,
    rect_x: Number(row.rect_x),
    rect_y: Number(row.rect_y),
    rect_w: Number(row.rect_w),
    rect_h: Number(row.rect_h),
    primary_node_id: primaryNodeId,
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

  let rect = normalized.rect;
  if (normalized.target.kind === "figma-node") {
    const nodeTarget = normalized.target;
    rect = normalizedNodeRect(
      surface.frame_bounds_json,
      surface.positional_nodes_json,
      nodeTarget.nodeId
    ) ?? undefined;
    if (!rect) return { ok: false, reason: "node_not_found" };
    if (
      rect.x < 0 ||
      rect.y < 0 ||
      rect.w <= 0 ||
      rect.h <= 0 ||
      rect.x + rect.w > 1 + 1e-12 ||
      rect.y + rect.h > 1 + 1e-12
    ) {
      return { ok: false, reason: "evidence_geometry_missing" };
    }
  }
  if (!rect) return { ok: false, reason: "evidence_geometry_missing" };

  const candidates =
    normalized.target.kind === "figma-region"
      ? (() => {
          let frameBoundsValue: unknown = null;
          try {
            frameBoundsValue = surface.frame_bounds_json
              ? JSON.parse(surface.frame_bounds_json)
              : null;
          } catch {
            frameBoundsValue = null;
          }
          const frameBounds = asEvidenceBounds(frameBoundsValue);
          return frameBounds
            ? getAnnotationNodeCandidates({
                nodes: parsePositionalNodes(surface.positional_nodes_json),
                frameBounds,
                rect
              })
            : [];
        })()
      : [];

  const record: RegionAnnotationRecord = {
    id: randomUUID(),
    surface_id: surface.id,
    surface_artifact_id: surfaceArtifactId,
    surface_node_id: surfaceNodeId,
    target_kind: normalized.target.kind,
    target_evidence_version_id: surface.id,
    target_node_id:
      normalized.target.kind === "figma-node"
        ? normalized.target.nodeId
        : null,
    current_evidence_version_id: surface.id,
    current_node_id:
      normalized.target.kind === "figma-node"
        ? normalized.target.nodeId
        : null,
    current_rect_x:
      normalized.target.kind === "figma-node" ? rect.x : null,
    current_rect_y:
      normalized.target.kind === "figma-node" ? rect.y : null,
    current_rect_w:
      normalized.target.kind === "figma-node" ? rect.w : null,
    current_rect_h:
      normalized.target.kind === "figma-node" ? rect.h : null,
    correspondence_status:
      normalized.target.kind === "figma-node"
        ? "corresponding"
        : "not_applicable",
    stale: false,
    author: normalized.author,
    type: normalized.type,
    body: normalized.body,
    section: normalized.section,
    rect_x: rect.x,
    rect_y: rect.y,
    rect_w: rect.w,
    rect_h: rect.h,
    primary_node_id: null,
    candidates_json: candidates.length > 0 ? JSON.stringify(candidates) : null,
    created_at: new Date().toISOString(),
    geometry_version: "v2_raw",
    from_point: normalized.fromPoint
  };

  try {
    const event = withProjectTransaction(projectPath, (db) => {
      db.prepare(
        `INSERT INTO region_annotations (
          id, surface_id, surface_artifact_id, surface_node_id,
          target_kind, target_evidence_version_id, target_node_id,
          author, type, body, section,
          rect_x, rect_y, rect_w, rect_h,
          primary_node_id, candidates_json, created_at,
          geometry_version, from_point
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.id,
        record.surface_id,
        record.surface_artifact_id,
        record.surface_node_id,
        record.target_kind,
        record.target_evidence_version_id,
        record.target_node_id,
        record.author,
        record.type,
        record.body,
        record.section,
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
      if (record.author === "designer") {
        recordCurrentDesignerAnnotationSemanticChangeOnDb(db, {
          sourceId: record.id,
          section: record.section,
          statement: record.body,
          now: record.created_at
        });
      }
      return logEventOnDb(db, "annotation_created", {
        annotation_id: record.id,
        surface_id: record.surface_id,
        surface_artifact_id: record.surface_artifact_id,
        surface_node_id: record.surface_node_id,
        target_kind: record.target_kind,
        target_evidence_version_id: record.target_evidence_version_id,
        target_node_id: record.target_node_id,
        author: record.author,
        type: record.type,
        section: record.section
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

/**
 * Persist the Agent's explicit primary-node confirmation as a separate fact.
 * Creation deliberately never infers primary_node_id from Runtime candidates.
 */
export function confirmAnnotationPrimaryNode(
  projectPath: string,
  input: unknown
): AnnotationPrimaryConfirmationResponse {
  if (!input || typeof input !== "object") {
    return { ok: false, reason: "invalid_confirmation" };
  }
  const raw = input as Record<string, unknown>;
  if (
    !isNonEmptyString(raw.annotationId) ||
    !isNonEmptyString(raw.evidenceVersionId) ||
    !isNonEmptyString(raw.sourceNodeId)
  ) {
    return { ok: false, reason: "invalid_confirmation" };
  }
  const annotationId = raw.annotationId.trim();
  const evidenceVersionId = raw.evidenceVersionId.trim();
  const sourceNodeId = raw.sourceNodeId.trim();

  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const annotation = db
        .prepare(
          `SELECT id, target_evidence_version_id, target_node_id, candidates_json
           FROM region_annotations WHERE id = ?`
        )
        .get(annotationId) as
        | {
            id: string;
            target_evidence_version_id: string;
            target_node_id: string | null;
            candidates_json: string | null;
          }
        | undefined;
      if (!annotation) {
        return {
          ok: false as const,
          reason: "annotation_not_found" as const
        };
      }
      if (annotation.target_evidence_version_id !== evidenceVersionId) {
        return { ok: false as const, reason: "surface_mismatch" as const };
      }

      let candidateIds: string[] = [];
      try {
        const parsed = annotation.candidates_json
          ? JSON.parse(annotation.candidates_json)
          : [];
        candidateIds = Array.isArray(parsed)
          ? parsed
              .map((candidate) =>
                candidate && typeof candidate === "object"
                  ? (candidate as { nodeId?: unknown }).nodeId
                  : null
              )
              .filter((nodeId): nodeId is string => typeof nodeId === "string")
          : [];
      } catch {
        candidateIds = [];
      }
      if (
        annotation.target_node_id !== sourceNodeId &&
        !candidateIds.includes(sourceNodeId)
      ) {
        return { ok: false as const, reason: "node_not_found" as const };
      }

      const surface = db
        .prepare(
          `SELECT positional_nodes_json FROM figma_evidence_surfaces WHERE id = ?`
        )
        .get(evidenceVersionId) as
        | { positional_nodes_json: string | null }
        | undefined;
      if (
        !surface ||
        !parsePositionalNodes(surface.positional_nodes_json).some(
          (node) => node.id === sourceNodeId
        )
      ) {
        return { ok: false as const, reason: "node_not_found" as const };
      }

      const confirmation: AnnotationPrimaryConfirmationRecord = {
        id: randomUUID(),
        annotation_id: annotationId,
        evidence_version_id: evidenceVersionId,
        source_node_id: sourceNodeId,
        created_at: new Date().toISOString()
      };
      db.prepare(
        `INSERT INTO annotation_primary_confirmations (
          id, annotation_id, evidence_version_id, source_node_id, created_at
        ) VALUES (?, ?, ?, ?, ?)`
      ).run(
        confirmation.id,
        confirmation.annotation_id,
        confirmation.evidence_version_id,
        confirmation.source_node_id,
        confirmation.created_at
      );
      db.prepare(
        `UPDATE region_annotations SET primary_node_id = ? WHERE id = ?`
      ).run(sourceNodeId, annotationId);
      const event = logEventOnDb(db, "annotation_primary_confirmed", {
        confirmation_id: confirmation.id,
        annotation_id: annotationId,
        evidence_version_id: evidenceVersionId,
        source_node_id: sourceNodeId
      });
      return { ok: true as const, confirmation, event_id: event.event_id };
    });
    if (!result.ok) return result;
    emitRecordEvent({
      kind: "annotation",
      action: "updated",
      id: annotationId,
      projectPath: path.resolve(projectPath)
    });
    return result;
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

export type RegionAnnotationRestoreReason =
  | "not_found"
  | "already_exists"
  | "not_restorable"
  | "db_error";

export type RegionAnnotationRestoreResponse =
  | { ok: true; id: string }
  | { ok: false; reason: RegionAnnotationRestoreReason };

type PersistedRegionAnnotationRow = {
  id: string;
  surface_id: string;
  surface_artifact_id: string | null;
  surface_node_id: string | null;
  author: string;
  type: string;
  body: string;
  rect_x: number;
  rect_y: number;
  rect_w: number;
  rect_h: number;
  primary_node_id: string | null;
  candidates_json: string | null;
  created_at: string;
  geometry_version: string;
  from_point: number;
  target_kind: string;
  target_evidence_version_id: string;
  target_node_id: string | null;
  section: string | null;
};

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
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const row = db
        .prepare("SELECT * FROM region_annotations WHERE id = ?")
        .get(id) as PersistedRegionAnnotationRow | undefined;
      if (!row) {
        return { ok: false as const, reason: "not_found" as const };
      }
      if (row.author !== "designer") {
        return { ok: false as const, reason: "not_deletable" as const };
      }
      const confirmations = db
        .prepare(
          `SELECT * FROM annotation_primary_confirmations
           WHERE annotation_id = ?
           ORDER BY created_at ASC`
        )
        .all(id) as unknown as AnnotationPrimaryConfirmationRecord[];
      const deletedAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO region_annotation_delete_tombstones (
           annotation_id, annotation_json, confirmations_json, deleted_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(annotation_id) DO UPDATE SET
           annotation_json = excluded.annotation_json,
           confirmations_json = excluded.confirmations_json,
           deleted_at = excluded.deleted_at`
      ).run(id, JSON.stringify(row), JSON.stringify(confirmations), deletedAt);
      recordCurrentDesignerAnnotationSemanticChangeOnDb(db, {
        sourceId: row.id,
        section: row.section,
        statement: row.body,
        operation: "delete",
        now: deletedAt
      });
      db.prepare("DELETE FROM region_annotations WHERE id = ?").run(id);
      logEventOnDb(db, "annotation_deleted", { annotation_id: id });
      return { ok: true as const, id };
    });
    if (!result.ok) return result;
    emitRecordEvent({
      kind: "annotation",
      action: "deleted",
      id,
      projectPath: path.resolve(projectPath)
    });
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

/**
 * Restore the exact Runtime row captured by the most recent designer delete.
 * Canvas state is never accepted as restore input: the tombstone owns body,
 * identity, evidence target, geometry, and primary-node confirmations.
 */
export function restoreRegionAnnotation(
  projectPath: string,
  annotationId: string
): RegionAnnotationRestoreResponse {
  if (typeof annotationId !== "string" || annotationId.trim().length === 0) {
    return { ok: false, reason: "not_found" };
  }
  const id = annotationId.trim();
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const existing = db
        .prepare("SELECT id FROM region_annotations WHERE id = ?")
        .get(id);
      if (existing) {
        return { ok: false as const, reason: "already_exists" as const };
      }
      const tombstone = db
        .prepare(
          `SELECT annotation_json, confirmations_json
           FROM region_annotation_delete_tombstones
           WHERE annotation_id = ?`
        )
        .get(id) as
        | { annotation_json: string; confirmations_json: string }
        | undefined;
      if (!tombstone) {
        return { ok: false as const, reason: "not_found" as const };
      }

      let row: PersistedRegionAnnotationRow;
      let confirmations: AnnotationPrimaryConfirmationRecord[];
      try {
        row = JSON.parse(
          tombstone.annotation_json
        ) as PersistedRegionAnnotationRow;
        confirmations = JSON.parse(
          tombstone.confirmations_json
        ) as AnnotationPrimaryConfirmationRecord[];
      } catch {
        return { ok: false as const, reason: "not_restorable" as const };
      }
      if (
        row.id !== id ||
        row.author !== "designer" ||
        !Array.isArray(confirmations)
      ) {
        return { ok: false as const, reason: "not_restorable" as const };
      }

      db.prepare(
        `INSERT INTO region_annotations (
          id, surface_id, surface_artifact_id, surface_node_id,
          author, type, body,
          rect_x, rect_y, rect_w, rect_h,
          primary_node_id, candidates_json, created_at,
          geometry_version, from_point,
          target_kind, target_evidence_version_id, target_node_id, section
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        row.id,
        row.surface_id,
        row.surface_artifact_id,
        row.surface_node_id,
        row.author,
        row.type,
        row.body,
        row.rect_x,
        row.rect_y,
        row.rect_w,
        row.rect_h,
        row.primary_node_id,
        row.candidates_json,
        row.created_at,
        row.geometry_version,
        row.from_point,
        row.target_kind,
        row.target_evidence_version_id,
        row.target_node_id,
        row.section
      );
      const restoreConfirmation = db.prepare(
        `INSERT INTO annotation_primary_confirmations (
          id, annotation_id, evidence_version_id, source_node_id, created_at
        ) VALUES (?, ?, ?, ?, ?)`
      );
      for (const confirmation of confirmations) {
        restoreConfirmation.run(
          confirmation.id,
          confirmation.annotation_id,
          confirmation.evidence_version_id,
          confirmation.source_node_id,
          confirmation.created_at
        );
      }
      recordCurrentDesignerAnnotationSemanticChangeOnDb(db, {
        sourceId: row.id,
        section: row.section,
        statement: row.body
      });
      db.prepare(
        `DELETE FROM region_annotation_delete_tombstones
         WHERE annotation_id = ?`
      ).run(id);
      logEventOnDb(db, "annotation_restored", { annotation_id: id });
      return { ok: true as const, id };
    });
    if (!result.ok) return result;
    emitRecordEvent({
      kind: "annotation",
      action: "created",
      id,
      projectPath: path.resolve(projectPath)
    });
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export type RegionAnnotationBodyUpdateReason =
  | "missing_body"
  | "not_found"
  | "not_editable"
  | "db_error";

export type RegionAnnotationBodyUpdateResponse =
  | { ok: true; id: string }
  | { ok: false; reason: RegionAnnotationBodyUpdateReason };

/**
 * Update the body text of a Region Annotation by id.
 * Product rule: only `author === "designer"` rows may be edited.
 * Body shape is validated before any DB lookup so a blank body always
 * reports `missing_body`. Row update + `annotation_body_updated` event are
 * written atomically.
 */
export function updateRegionAnnotationBody(
  projectPath: string,
  input: unknown
): RegionAnnotationBodyUpdateResponse {
  if (!input || typeof input !== "object") {
    return { ok: false, reason: "not_found" };
  }
  const raw = input as Record<string, unknown>;
  if (!isNonEmptyString(raw.annotationId)) {
    return { ok: false, reason: "not_found" };
  }
  if (!isNonEmptyString(raw.body)) {
    return { ok: false, reason: "missing_body" };
  }
  const id = raw.annotationId.trim();
  const body = raw.body.trim();

  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const row = db
        .prepare("SELECT id, author, section FROM region_annotations WHERE id = ?")
        .get(id) as { id: string; author: string; section: string | null } | undefined;
      if (!row) {
        return { ok: false as const, reason: "not_found" as const };
      }
      if (row.author !== "designer") {
        return { ok: false as const, reason: "not_editable" as const };
      }
      db.prepare("UPDATE region_annotations SET body = ? WHERE id = ?").run(
        body,
        id
      );
      recordCurrentDesignerAnnotationSemanticChangeOnDb(db, {
        sourceId: id,
        section: row.section,
        statement: body
      });
      logEventOnDb(db, "annotation_body_updated", {
        annotation_id: id,
        body
      });
      return { ok: true as const, id };
    });
    if (!result.ok) return result;
    emitRecordEvent({
      kind: "annotation",
      action: "updated",
      id,
      projectPath: path.resolve(projectPath)
    });
    return { ok: true, id };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export type RegionAnnotationListFilter = {
  /** Restrict to one author — e.g. the Alignment snapshot reads only
   *  `designer` rows (Issue 08A: Designer Annotations are part of Design
   *  Intent Alignment). */
  author?: RegionAnnotationAuthor;
};

/** On-Db variant for callers already holding an open project connection. */
export function listRegionAnnotationsOnDb(
  db: DatabaseType,
  filter: RegionAnnotationListFilter = {}
): RegionAnnotationRecord[] {
  const rows = db
    .prepare(
      `SELECT ra.*,
              current_surface.id AS current_evidence_version_id,
              current_surface.frame_bounds_json AS current_frame_bounds_json,
              current_surface.positional_nodes_json AS current_positional_nodes_json
       FROM region_annotations ra
       INNER JOIN figma_evidence_surfaces captured_surface
         ON captured_surface.id = ra.target_evidence_version_id
       INNER JOIN seed_references seed
         ON seed.id = captured_surface.seed_reference_id
       LEFT JOIN figma_evidence_surfaces current_surface
         ON current_surface.id = seed.current_surface_id
       ${filter.author ? "WHERE ra.author = ?" : ""}
       ORDER BY ra.created_at ASC`
    )
    .all(...(filter.author ? [filter.author] : [])) as Array<
    Record<string, unknown>
  >;
  return rows.map(mapAnnotationRow);
}

/** Oldest-first — matches listSeedReferences / listFigmaEvidenceSurfaces. */
export function listRegionAnnotations(
  projectPath: string,
  filter: RegionAnnotationListFilter = {}
): RegionAnnotationRecord[] {
  const db = openProjectDb(projectPath);
  try {
    return listRegionAnnotationsOnDb(db, filter);
  } finally {
    closeProjectDb(db);
  }
}
