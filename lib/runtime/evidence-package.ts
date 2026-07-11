// Evidence package schema validation + Figma Evidence Surface persistence (Issue 05).
//
// Agent host declares Figma evidence via a structured package. Runtime validates
// schema, then inserts a `figma_evidence_surfaces` row — no Figma network, no MCP.
//
// URL format rules mirror seed-reference.ts local checks (https + figma.com +
// /design|/file path). Original URL strings are kept verbatim when present.
//
// On validation / resolve failure: `invalid_output` event + structured error,
// NO surface row.
//
// Record + `evidence_package_recorded` are written atomically. Event write
// failure rolls back the surface row and returns `ok: false` / `db_error`.

import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import { openProjectDb, closeProjectDb, withProjectTransaction } from "./db";
import { emitRecordEvent } from "./record-bus";
import { logEvent, logEventOnDb } from "./events";
import {
  parseFigmaSeedIdentity,
  figmaSeedIdentitiesEqual,
  normalizeFigmaNodeId
} from "./figma-identity";

export type EvidenceViewStatus = "available" | "missing";

export interface EvidencePackageFrameBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EvidencePackageFrame {
  nodeId: string;
  name: string;
  /** Optional; when present must match the seed's canonical file_key. */
  fileKey?: string;
  bounds?: EvidencePackageFrameBounds;
}

export interface EvidenceViews {
  rawData: EvidenceViewStatus;
  screenshot: EvidenceViewStatus;
}

export interface EvidenceScreenshot {
  artifactPath?: string;
  dataUrl?: string;
}

export interface DesignSignal {
  id: string;
  label: string;
  evidence: string;
}

export interface SurfaceBounds {
  width: number;
  height: number;
}

/** Input shape accepted by validateEvidencePackage (unknown fields ignored). */
export interface EvidencePackageInput {
  figmaSeedReference?: string;
  seedReferenceId?: string;
  frame: EvidencePackageFrame;
  evidenceViews: EvidenceViews;
  screenshot?: EvidenceScreenshot;
  designSignals?: DesignSignal[];
  surfaceBounds?: SurfaceBounds;
}

/** Normalized package returned on successful validation. */
export interface NormalizedEvidencePackage {
  figmaSeedReference?: string;
  seedReferenceId?: string;
  frame: EvidencePackageFrame;
  evidenceViews: EvidenceViews;
  screenshot?: EvidenceScreenshot;
  designSignals?: DesignSignal[];
  surfaceBounds?: SurfaceBounds;
}

export type EvidencePackageValidationReason =
  | "missing_seed_reference"
  | "missing_figma_seed_reference"
  | "invalid_figma_url"
  | "not_figma_host"
  | "not_figma_design_path"
  | "missing_frame"
  | "missing_frame_node_id"
  | "missing_frame_name"
  | "invalid_frame_bounds"
  | "missing_evidence_views"
  | "invalid_evidence_views"
  | "screenshot_required_when_available"
  | "screenshot_payload_when_missing"
  | "screenshot_too_large"
  | "invalid_screenshot_data_url"
  | "invalid_screenshot"
  | "invalid_design_signals"
  | "design_signals_too_many"
  | "invalid_surface_bounds";

export type EvidencePackageOk = {
  ok: true;
  package: NormalizedEvidencePackage;
};

export type EvidencePackageError = {
  ok: false;
  reason: EvidencePackageValidationReason | string;
  details?: unknown;
};

export type EvidencePackageValidationResult =
  | EvidencePackageOk
  | EvidencePackageError;

const SCREENSHOT_DATA_URL_MAX_CHARS = 2_000_000;

/**
 * Agent-supplied inline screenshots must be image data URLs only — never
 * https://… (would let the Workbench <img> fetch external hosts, including
 * Figma, and break the zero-Figma / local-projection boundary).
 */
const SCREENSHOT_IMAGE_DATA_URL_RE =
  /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+=*$/i;

export function isScreenshotImageDataUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("data:image/")) return false;
  // Allow whitespace-free base64 body; reject remote URLs and non-image schemes.
  return SCREENSHOT_IMAGE_DATA_URL_RE.test(trimmed);
}
const DESIGN_SIGNALS_MAX = 20;

/** Local Figma URL format check — same rules as seed-reference.ts. No network. */
export function validateFigmaSeedReferenceUrl(
  rawUrl: string
): "invalid_figma_url" | "not_figma_host" | "not_figma_design_path" | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return "invalid_figma_url";
  }
  if (url.protocol !== "https:") {
    return "invalid_figma_url";
  }
  if (url.hostname !== "figma.com" && url.hostname !== "www.figma.com") {
    return "not_figma_host";
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const hasDesignPath =
    parts.length >= 2 && (parts[0] === "design" || parts[0] === "file");
  if (!hasDesignPath) {
    return "not_figma_design_path";
  }
  return null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isEvidenceViewStatus(value: unknown): value is EvidenceViewStatus {
  return value === "available" || value === "missing";
}

function fail(
  reason: EvidencePackageValidationReason | string,
  details?: unknown
): EvidencePackageError {
  return details === undefined
    ? { ok: false, reason }
    : { ok: false, reason, details };
}

export function validateEvidencePackage(
  input: unknown
): EvidencePackageValidationResult {
  if (input === null || typeof input !== "object") {
    return fail("missing_frame", { message: "input must be an object" });
  }
  const raw = input as Record<string, unknown>;

  // --- seed reference: at least one of figmaSeedReference | seedReferenceId ---
  const figmaRaw = raw.figmaSeedReference;
  const seedIdRaw = raw.seedReferenceId;
  const hasFigma =
    typeof figmaRaw === "string" && figmaRaw.trim().length > 0;
  const hasSeedId =
    typeof seedIdRaw === "string" && seedIdRaw.trim().length > 0;

  if (!hasFigma && !hasSeedId) {
    return fail("missing_seed_reference");
  }

  let figmaSeedReference: string | undefined;
  if (hasFigma) {
    const urlError = validateFigmaSeedReferenceUrl(figmaRaw);
    if (urlError) {
      return fail(urlError);
    }
    // Keep original string verbatim (do not trim/rewrite for storage).
    figmaSeedReference = figmaRaw;
  }

  const seedReferenceId = hasSeedId ? seedIdRaw : undefined;

  // --- frame ---
  const frameRaw = raw.frame;
  if (frameRaw === null || typeof frameRaw !== "object") {
    return fail("missing_frame");
  }
  const frameObj = frameRaw as Record<string, unknown>;
  if (!isNonEmptyString(frameObj.nodeId)) {
    return fail("missing_frame_node_id");
  }
  if (!isNonEmptyString(frameObj.name)) {
    return fail("missing_frame_name");
  }

  const frame: EvidencePackageFrame = {
    nodeId: frameObj.nodeId,
    name: frameObj.name
  };
  if (isNonEmptyString(frameObj.fileKey)) {
    frame.fileKey = frameObj.fileKey;
  }

  if (frameObj.bounds !== undefined) {
    if (frameObj.bounds === null || typeof frameObj.bounds !== "object") {
      return fail("invalid_frame_bounds");
    }
    const b = frameObj.bounds as Record<string, unknown>;
    if (
      !isFiniteNumber(b.x) ||
      !isFiniteNumber(b.y) ||
      !isFiniteNumber(b.width) ||
      !isFiniteNumber(b.height)
    ) {
      return fail("invalid_frame_bounds");
    }
    frame.bounds = {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height
    };
  }

  // --- evidenceViews ---
  const viewsRaw = raw.evidenceViews;
  if (viewsRaw === null || typeof viewsRaw !== "object") {
    return fail("missing_evidence_views");
  }
  const viewsObj = viewsRaw as Record<string, unknown>;
  if (
    !isEvidenceViewStatus(viewsObj.rawData) ||
    !isEvidenceViewStatus(viewsObj.screenshot)
  ) {
    return fail("invalid_evidence_views");
  }
  const evidenceViews: EvidenceViews = {
    rawData: viewsObj.rawData,
    screenshot: viewsObj.screenshot
  };

  // --- screenshot ---
  let screenshot: EvidenceScreenshot | undefined;
  const shotRaw = raw.screenshot;

  if (evidenceViews.screenshot === "available") {
    if (shotRaw === null || typeof shotRaw !== "object") {
      return fail("screenshot_required_when_available");
    }
    const shot = shotRaw as Record<string, unknown>;
    const artifactPath =
      typeof shot.artifactPath === "string" ? shot.artifactPath : undefined;
    const dataUrl =
      typeof shot.dataUrl === "string" ? shot.dataUrl : undefined;
    const hasArtifact =
      typeof artifactPath === "string" && artifactPath.trim().length > 0;
    const hasDataUrl =
      typeof dataUrl === "string" && dataUrl.trim().length > 0;

    if (!hasArtifact && !hasDataUrl) {
      return fail("screenshot_required_when_available");
    }
    if (hasDataUrl && !isScreenshotImageDataUrl(dataUrl!)) {
      return fail("invalid_screenshot_data_url");
    }
    if (hasDataUrl && dataUrl!.length > SCREENSHOT_DATA_URL_MAX_CHARS) {
      return fail("screenshot_too_large", {
        maxChars: SCREENSHOT_DATA_URL_MAX_CHARS,
        length: dataUrl!.length
      });
    }

    screenshot = {};
    if (hasArtifact) screenshot.artifactPath = artifactPath;
    if (hasDataUrl) screenshot.dataUrl = dataUrl!.trim();
  } else {
    // screenshot === "missing"
    if (shotRaw !== undefined && shotRaw !== null) {
      if (typeof shotRaw !== "object") {
        return fail("screenshot_payload_when_missing");
      }
      const shot = shotRaw as Record<string, unknown>;
      const hasArtifact =
        typeof shot.artifactPath === "string" &&
        shot.artifactPath.trim().length > 0;
      const hasDataUrl =
        typeof shot.dataUrl === "string" && shot.dataUrl.trim().length > 0;
      if (hasArtifact || hasDataUrl) {
        return fail("screenshot_payload_when_missing");
      }
      // Empty object / empty strings — treat as no payload; still reject for
      // strictness if any screenshot key was supplied with content above.
      // Bare `{}` or undefined fields: reject if object present with any keys?
      // Prefer: only reject when non-empty payload fields exist (already done).
      // If object is present but empty, ignore (no payload).
    }
  }

  // --- designSignals (optional) ---
  let designSignals: DesignSignal[] | undefined;
  if (raw.designSignals !== undefined) {
    if (!Array.isArray(raw.designSignals)) {
      return fail("invalid_design_signals");
    }
    if (raw.designSignals.length > DESIGN_SIGNALS_MAX) {
      return fail("design_signals_too_many", { max: DESIGN_SIGNALS_MAX });
    }
    designSignals = [];
    for (let i = 0; i < raw.designSignals.length; i++) {
      const item = raw.designSignals[i];
      if (item === null || typeof item !== "object") {
        return fail("invalid_design_signals", { index: i });
      }
      const s = item as Record<string, unknown>;
      if (
        !isNonEmptyString(s.id) ||
        !isNonEmptyString(s.label) ||
        !isNonEmptyString(s.evidence)
      ) {
        return fail("invalid_design_signals", { index: i });
      }
      designSignals.push({
        id: s.id,
        label: s.label,
        evidence: s.evidence
      });
    }
  }

  // --- surfaceBounds (optional) ---
  let surfaceBounds: SurfaceBounds | undefined;
  if (raw.surfaceBounds !== undefined) {
    if (raw.surfaceBounds === null || typeof raw.surfaceBounds !== "object") {
      return fail("invalid_surface_bounds");
    }
    const sb = raw.surfaceBounds as Record<string, unknown>;
    if (
      !isFiniteNumber(sb.width) ||
      !isFiniteNumber(sb.height) ||
      sb.width <= 0 ||
      sb.height <= 0
    ) {
      return fail("invalid_surface_bounds");
    }
    surfaceBounds = { width: sb.width, height: sb.height };
  }

  const normalized: NormalizedEvidencePackage = {
    frame,
    evidenceViews
  };
  if (figmaSeedReference !== undefined) {
    normalized.figmaSeedReference = figmaSeedReference;
  }
  if (seedReferenceId !== undefined) {
    normalized.seedReferenceId = seedReferenceId;
  }
  if (screenshot !== undefined) {
    normalized.screenshot = screenshot;
  }
  if (designSignals !== undefined) {
    normalized.designSignals = designSignals;
  }
  if (surfaceBounds !== undefined) {
    normalized.surfaceBounds = surfaceBounds;
  }

  return { ok: true, package: normalized };
}

// ---------------------------------------------------------------------------
// Persist: recordEvidencePackage / listFigmaEvidenceSurfaces
// ---------------------------------------------------------------------------

export interface FigmaEvidenceSurfaceRecord {
  id: string;
  seed_reference_id: string;
  figma_seed_reference: string;
  frame_node_id: string;
  frame_name: string;
  frame_bounds_json: string | null;
  evidence_views_json: string;
  screenshot_artifact_path: string | null;
  screenshot_data_url: string | null;
  design_signals_json: string | null;
  surface_bounds_json: string | null;
  created_at: string;
  /** Next declaration in append-only lineage; null for current tip. */
  superseded_by: string | null;
}

export type EvidencePackageRecordReason =
  | EvidencePackageValidationReason
  | "seed_reference_not_found"
  | "seed_reference_mismatch"
  | "frame_node_mismatch"
  | "artifact_path_escape"
  | "db_error"
  | string;

export interface EvidencePackageRecordResult {
  ok: true;
  record: FigmaEvidenceSurfaceRecord;
  /** Canonical audit event id (always a string on success). */
  event_id: string;
}

export interface EvidencePackageRecordError {
  ok: false;
  reason: EvidencePackageRecordReason;
}

export type EvidencePackageRecordResponse =
  | EvidencePackageRecordResult
  | EvidencePackageRecordError;

function logInvalidOutput(
  projectPath: string,
  reason: string,
  details?: unknown
): void {
  try {
    const payload: Record<string, unknown> = {
      tool: "record_evidence_package",
      reason
    };
    if (details !== undefined) payload.details = details;
    logEvent(projectPath, "invalid_output", payload);
  } catch {
    // Best-effort: do not mask the structured validation error if audit fails.
  }
}

/** True when `candidate` is strictly inside `root` (not equal, not outside). */
function isStrictlyInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
}

/**
 * Realpath a path that may not exist yet: realpath the deepest existing
 * ancestor, then rejoin the missing basename chain. Fail-closed on errors.
 */
function realpathMaybeMissing(candidate: string): string | null {
  const missing: string[] = [];
  let cursor = candidate;
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return null;
    }
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
  let realExisting: string;
  try {
    realExisting = realpathSync(cursor);
  } catch {
    return null;
  }
  return missing.length === 0
    ? realExisting
    : path.resolve(realExisting, ...missing);
}

/**
 * Ensure a project-relative artifact path stays under project root.
 * Lexical resolve first, then realpath (including symlink targets) so
 * symlink escapes fail closed. Does NOT require the file to exist yet
 * (Agent may declare before write) — missing tails use realpath(parent)+basename.
 * Exported so GET /api/artifacts can reuse the same escape check.
 */
export function assertArtifactPathInProject(
  projectPath: string,
  artifactPath: string
): "artifact_path_escape" | null {
  const projectRoot = path.resolve(projectPath);
  const resolved = path.resolve(projectRoot, artifactPath);

  // Lexical containment (also rejects the project root itself as an artifact).
  if (!isStrictlyInsideRoot(projectRoot, resolved)) {
    return "artifact_path_escape";
  }

  let projectReal: string;
  try {
    projectReal = realpathSync(projectRoot);
  } catch {
    // Project root must be resolvable; fail closed.
    return "artifact_path_escape";
  }

  const realFinal = realpathMaybeMissing(resolved);
  if (realFinal === null || !isStrictlyInsideRoot(projectReal, realFinal)) {
    return "artifact_path_escape";
  }

  return null;
}

/**
 * Resolve a project-relative artifact path to a contained absolute path;
 * null if empty or escape (including symlink escape). When the target
 * exists, returns its realpath so GET reads cannot follow a link out.
 */
export function resolveProjectArtifactPath(
  projectPath: string,
  artifactPath: string
): string | null {
  if (typeof artifactPath !== "string" || artifactPath.trim().length === 0) {
    return null;
  }
  if (assertArtifactPathInProject(projectPath, artifactPath) !== null) {
    return null;
  }
  const resolved = path.resolve(path.resolve(projectPath), artifactPath);
  return realpathMaybeMissing(resolved) ?? resolved;
}

function lookupSeedById(
  db: DatabaseType,
  seedReferenceId: string
): {
  id: string;
  figma_seed_reference: string;
  file_key: string;
  node_id: string;
  current_surface_id: string | null;
} | null {
  const row = db
    .prepare(
      `SELECT id, figma_seed_reference, file_key, node_id, current_surface_id
       FROM seed_references WHERE id = ?`
    )
    .get(seedReferenceId) as
    | {
        id: string;
        figma_seed_reference: string;
        file_key: string;
        node_id: string;
        current_surface_id: string | null;
      }
    | undefined;
  return row ?? null;
}

function lookupSeedByIdentity(
  db: DatabaseType,
  fileKey: string,
  nodeId: string
): {
  id: string;
  figma_seed_reference: string;
  file_key: string;
  node_id: string;
  current_surface_id: string | null;
} | null {
  const row = db
    .prepare(
      `SELECT id, figma_seed_reference, file_key, node_id, current_surface_id
       FROM seed_references WHERE file_key = ? AND node_id = ?`
    )
    .get(fileKey, nodeId) as
    | {
        id: string;
        figma_seed_reference: string;
        file_key: string;
        node_id: string;
        current_surface_id: string | null;
      }
    | undefined;
  return row ?? null;
}

/**
 * Resolve package input to a unique seed. Compares canonical identity when both
 * URL and seed id are present (different `t=` allowed).
 */
function resolveEvidenceSeed(
  db: DatabaseType,
  pkg: NormalizedEvidencePackage
):
  | {
      ok: true;
      seedId: string;
      figmaSeedReference: string;
      fileKey: string;
      nodeId: string;
      previousCurrentSurfaceId: string | null;
    }
  | { ok: false; reason: "seed_reference_not_found" | "seed_reference_mismatch" } {
  const hasUrl = pkg.figmaSeedReference !== undefined;
  const hasSeedId = pkg.seedReferenceId !== undefined;

  if (hasSeedId && !hasUrl) {
    const seed = lookupSeedById(db, pkg.seedReferenceId!);
    if (!seed) {
      return { ok: false, reason: "seed_reference_not_found" };
    }
    return {
      ok: true,
      seedId: seed.id,
      figmaSeedReference: seed.figma_seed_reference,
      fileKey: seed.file_key,
      nodeId: seed.node_id,
      previousCurrentSurfaceId: seed.current_surface_id
    };
  }

  if (hasUrl && !hasSeedId) {
    const identity = parseFigmaSeedIdentity(pkg.figmaSeedReference!);
    if (!identity) {
      return { ok: false, reason: "seed_reference_not_found" };
    }
    const seed = lookupSeedByIdentity(db, identity.fileKey, identity.nodeId);
    if (!seed) {
      return { ok: false, reason: "seed_reference_not_found" };
    }
    return {
      ok: true,
      seedId: seed.id,
      // Keep declared URL verbatim (may differ in t= from seed row).
      figmaSeedReference: pkg.figmaSeedReference!,
      fileKey: seed.file_key,
      nodeId: seed.node_id,
      previousCurrentSurfaceId: seed.current_surface_id
    };
  }

  // Both provided: load by id, compare canonical identity (not raw URL).
  const seed = lookupSeedById(db, pkg.seedReferenceId!);
  if (!seed) {
    return { ok: false, reason: "seed_reference_not_found" };
  }
  const urlIdentity = parseFigmaSeedIdentity(pkg.figmaSeedReference!);
  if (!urlIdentity) {
    return { ok: false, reason: "seed_reference_mismatch" };
  }
  if (
    !figmaSeedIdentitiesEqual(urlIdentity, {
      fileKey: seed.file_key,
      nodeId: seed.node_id
    })
  ) {
    return { ok: false, reason: "seed_reference_mismatch" };
  }
  return {
    ok: true,
    seedId: seed.id,
    figmaSeedReference: pkg.figmaSeedReference!,
    fileKey: seed.file_key,
    nodeId: seed.node_id,
    previousCurrentSurfaceId: seed.current_surface_id
  };
}

/**
 * Frame must declare the seed's canonical node. Optional frame.fileKey must
 * match seed file identity when present. Fail closed — do not record.
 */
function assertFrameMatchesSeed(
  pkg: NormalizedEvidencePackage,
  seed: { fileKey: string; nodeId: string }
): { ok: true } | { ok: false; reason: "frame_node_mismatch" } {
  if (normalizeFigmaNodeId(pkg.frame.nodeId) !== seed.nodeId) {
    return { ok: false, reason: "frame_node_mismatch" };
  }
  if (
    pkg.frame.fileKey !== undefined &&
    pkg.frame.fileKey !== seed.fileKey
  ) {
    return { ok: false, reason: "frame_node_mismatch" };
  }
  return { ok: true };
}

export function recordEvidencePackage(
  projectPath: string,
  input: unknown
): EvidencePackageRecordResponse {
  const validated = validateEvidencePackage(input);
  if (!validated.ok) {
    logInvalidOutput(projectPath, validated.reason, validated.details);
    return { ok: false, reason: validated.reason };
  }

  const pkg = validated.package;

  // Path-escape check only — file need not exist yet.
  let screenshotArtifactPath: string | null = null;
  let screenshotDataUrl: string | null = null;
  if (pkg.screenshot?.artifactPath) {
    const escape = assertArtifactPathInProject(
      projectPath,
      pkg.screenshot.artifactPath
    );
    if (escape) {
      logInvalidOutput(projectPath, escape);
      return { ok: false, reason: escape };
    }
    screenshotArtifactPath = pkg.screenshot.artifactPath;
  }
  if (pkg.screenshot?.dataUrl) {
    screenshotDataUrl = pkg.screenshot.dataUrl;
  }

  const surfaceId = randomUUID();
  const createdAt = new Date().toISOString();

  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const resolved = resolveEvidenceSeed(db, pkg);
      if (!resolved.ok) {
        const err = new Error(`EVIDENCE_RESOLVE:${resolved.reason}`);
        (err as Error & { evidenceReason: string }).evidenceReason =
          resolved.reason;
        throw err;
      }

      const frameMatch = assertFrameMatchesSeed(pkg, {
        fileKey: resolved.fileKey,
        nodeId: resolved.nodeId
      });
      if (!frameMatch.ok) {
        const err = new Error(`EVIDENCE_RESOLVE:${frameMatch.reason}`);
        (err as Error & { evidenceReason: string }).evidenceReason =
          frameMatch.reason;
        throw err;
      }

      const record: FigmaEvidenceSurfaceRecord = {
        id: surfaceId,
        seed_reference_id: resolved.seedId,
        figma_seed_reference: resolved.figmaSeedReference,
        frame_node_id: pkg.frame.nodeId,
        frame_name: pkg.frame.name,
        frame_bounds_json: pkg.frame.bounds
          ? JSON.stringify(pkg.frame.bounds)
          : null,
        evidence_views_json: JSON.stringify(pkg.evidenceViews),
        screenshot_artifact_path: screenshotArtifactPath,
        screenshot_data_url: screenshotDataUrl,
        design_signals_json: pkg.designSignals
          ? JSON.stringify(pkg.designSignals)
          : null,
        surface_bounds_json: pkg.surfaceBounds
          ? JSON.stringify(pkg.surfaceBounds)
          : null,
        created_at: createdAt,
        superseded_by: null
      };

      db.prepare(
        `INSERT INTO figma_evidence_surfaces (
          id, seed_reference_id, figma_seed_reference,
          frame_node_id, frame_name, frame_bounds_json,
          evidence_views_json, screenshot_artifact_path, screenshot_data_url,
          design_signals_json, surface_bounds_json, created_at, superseded_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      ).run(
        record.id,
        record.seed_reference_id,
        record.figma_seed_reference,
        record.frame_node_id,
        record.frame_name,
        record.frame_bounds_json,
        record.evidence_views_json,
        record.screenshot_artifact_path,
        record.screenshot_data_url,
        record.design_signals_json,
        record.surface_bounds_json,
        record.created_at
      );

      if (resolved.previousCurrentSurfaceId) {
        const advanceTip = db
          .prepare(
            `UPDATE figma_evidence_surfaces
             SET superseded_by = ?
             WHERE id = ? AND superseded_by IS NULL`
          )
          .run(record.id, resolved.previousCurrentSurfaceId);
        if (advanceTip.changes !== 1) {
          throw new Error(
            `Evidence lineage conflict: expected current surface ${resolved.previousCurrentSurfaceId} to be an unsuperseded tip`
          );
        }
      }

      const advanceCurrent =
        resolved.previousCurrentSurfaceId === null
          ? db
              .prepare(
                `UPDATE seed_references
                 SET current_surface_id = ?
                 WHERE id = ? AND current_surface_id IS NULL`
              )
              .run(record.id, resolved.seedId)
          : db
              .prepare(
                `UPDATE seed_references
                 SET current_surface_id = ?
                 WHERE id = ? AND current_surface_id = ?`
              )
              .run(
                record.id,
                resolved.seedId,
                resolved.previousCurrentSurfaceId
              );
      if (advanceCurrent.changes !== 1) {
        throw new Error(
          `Evidence current pointer conflict for seed ${resolved.seedId}`
        );
      }

      const event = logEventOnDb(db, "evidence_package_recorded", {
        surface_id: record.id,
        seed_reference_id: record.seed_reference_id,
        figma_seed_reference: record.figma_seed_reference,
        frame_node_id: record.frame_node_id,
        frame_name: record.frame_name
      });

      return { ok: true as const, record, event_id: event.event_id };
    });

    if (result.ok) {
      emitRecordEvent({
        kind: "evidence",
        action: "created",
        id: result.record.id,
        projectPath: path.resolve(projectPath)
      });
    }

    return result;
  } catch (err) {
    const reason =
      err instanceof Error &&
      typeof (err as Error & { evidenceReason?: string }).evidenceReason ===
        "string"
        ? (err as Error & { evidenceReason: string }).evidenceReason
        : err instanceof Error && err.message.startsWith("EVIDENCE_RESOLVE:")
          ? err.message.slice("EVIDENCE_RESOLVE:".length)
          : null;
    if (
      reason === "seed_reference_not_found" ||
      reason === "seed_reference_mismatch" ||
      reason === "frame_node_mismatch"
    ) {
      logInvalidOutput(projectPath, reason);
      return { ok: false, reason };
    }
    return { ok: false, reason: "db_error" };
  }
}

export function listFigmaEvidenceSurfaces(
  projectPath: string
): FigmaEvidenceSurfaceRecord[] {
  const db = openProjectDb(projectPath);
  try {
    return db
      .prepare(
        "SELECT * FROM figma_evidence_surfaces ORDER BY created_at ASC"
      )
      .all() as unknown as FigmaEvidenceSurfaceRecord[];
  } finally {
    closeProjectDb(db);
  }
}
