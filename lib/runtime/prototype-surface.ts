// Prototype runs and Prototype Evidence Surfaces (Issue 30).
//
// `record_preview` is the only way a Prototype Evidence Surface comes into
// existence — there is no generic create_evidence_surface tool. One call
// creates or updates:
//
//   - a prototype RUN, which freezes what the reconstruction was built from
//     (seed reference ids, evidence version ids, design-system version), so a
//     later reading can tell which evidence a preview actually reflects;
//   - a prototype SURFACE per previewable page, carrying the Runtime-owned
//     dev-server lifecycle (preview-server.ts) and a stable preview URL.
//
// Phase gate (Issue 28): nothing may be previewed before the designer
// confirms the draft design system. Runtime never validates or maps DOM
// context — Issue 30 explicitly drops Runtime-side DOM inspection.

import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import {
  closeProjectDb,
  openProjectDb,
  withProjectTransaction
} from "./db";
import { logEvent, logEventOnDb } from "./events";
import { parseJsonStringArray } from "./json-columns";
import { emitRecordEvent } from "./record-bus";
import { assertArtifactPathInProject } from "./evidence-package";
import { requireProjectPhase, type ProjectPhase } from "./project-phase";
import {
  allocatePreviewPort,
  defaultPreviewSupervisorDeps,
  isAllowedDevCommand,
  previewUrlForPort,
  startPreviewServer,
  type PreviewReadiness,
  type PreviewSupervisorDeps
} from "./preview-server";
import { capturePrototypeSurfaceScreenshot } from "./prototype-screenshot";
import {
  composePrototypeSurfaceUrl,
  normalizePrototypeRoutePath
} from "./prototype-route";
import {
  isPrototypePreviewRefreshActive,
  refreshCoveredPrototypeSurfacesAfterArtifact,
  startPrototypePreviewRefresh,
  stopPrototypePreviewRefresh,
  type PrototypePreviewRefreshHost
} from "./prototype-preview-refresh";

/** Phases where a prototype preview is meaningful (post confirm_draft). */
export const PREVIEW_ALLOWED_PHASES = [
  "prototype_validation",
  "design_system_formal",
  "ready_for_new_design"
] as const satisfies readonly ProjectPhase[];

export const DEFAULT_DEV_COMMAND = "npm run dev";
const DEFAULT_SURFACE_KEY = "default";

export interface PrototypeRunRecord {
  id: string;
  run_id: string;
  source_artifact_path: string;
  prototype_root: string;
  dev_command: string;
  seed_reference_ids: string[];
  evidence_version_ids: string[];
  design_system_version: string;
  created_at: string;
  updated_at: string;
}

export interface PrototypeSurfaceRecord {
  id: string;
  prototype_run_id: string;
  run_id: string;
  surface_key: string;
  name: string;
  /** Runtime-owned dev-server origin; component harnesses mount from here. */
  preview_url: string;
  /** Page represented by this surface inside preview_url. */
  route_path: string;
  /** Derived page URL used by the canvas, screenshot and readiness probe. */
  surface_url: string;
  preview_port: number;
  readiness: PreviewReadiness;
  readiness_reason: string | null;
  stale: boolean;
  stale_reason: string | null;
  /** Runtime-captured preview bitmap, project-relative; null until captured. */
  screenshot_artifact_path: string | null;
  screenshot_captured_at: string | null;
  /** Monotonic source revision watched for screenshot refresh. */
  source_generation: number;
  /** Last source generation a screenshot was persisted for. */
  screenshot_generation: number;
  created_at: string;
  updated_at: string;
}

export interface RecordPreviewInput {
  /** Run grouping marker, shared with designer feedback aggregation. */
  runId: string;
  /** Declared prototype/code artifact this preview was built from. */
  sourceArtifactPath: string;
  /** Explicit page path inside the preview server; defaults to `/`. */
  routePath?: string;
  /** Project-relative prototype root; defaults to the project root. */
  prototypeRoot?: string;
  devCommand?: string;
  /** Stable identity of one previewable page inside the run. */
  surfaceKey?: string;
  name?: string;
  seedReferenceIds?: string[];
  evidenceVersionIds?: string[];
}

export type RecordPreviewFailureReason =
  | "invalid_preview"
  | "dev_command_not_allowed"
  | "phase_gate"
  | "prototype_artifact_not_declared"
  | "linkage_record_not_found"
  | "missing_seed_evidence"
  | "artifact_path_escape"
  | "no_available_preview_port"
  | "db_error";

export type RecordPreviewResult =
  | {
      ok: true;
      run: PrototypeRunRecord;
      surface: PrototypeSurfaceRecord;
      readiness: PreviewReadiness;
      preview_url: string;
      event_id: string | null;
    }
  | {
      ok: false;
      reason: RecordPreviewFailureReason;
      phase?: ProjectPhase;
    };

export interface RecordPreviewOptions {
  supervisor?: PreviewSupervisorDeps;
  /** Overall budget for this readiness attempt (ms). */
  timeoutMs?: number;
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function idList(value: readonly string[] | undefined): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const ids = value.map((entry) => trimmed(entry));
  if (ids.some((id) => id.length === 0)) return null;
  return [...new Set(ids)];
}

/**
 * Design-system version = digest of the ingested design-system source index.
 * Runtime derives it from its own records instead of trusting an Agent-declared
 * version string; `unversioned` means nothing has been ingested yet.
 */
export function designSystemVersionOnDb(db: DatabaseType): string {
  const rows = db
    .prepare(
      `SELECT path, declaration_version, content_digest
       FROM source_artifacts
       WHERE status = 'ingested'
       ORDER BY path ASC`
    )
    .all() as Array<{
    path: string;
    declaration_version: number;
    content_digest: string | null;
  }>;
  if (rows.length === 0) return "unversioned";
  const canonical = rows
    .map(
      (row) =>
        `${row.path}:${row.declaration_version}:${row.content_digest ?? ""}`
    )
    .join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** Project-relative prototype root; "" means the project root itself. */
function normalizePrototypeRoot(
  projectPath: string,
  input: string | undefined
): string | null {
  const raw = trimmed(input);
  if (raw.length === 0 || raw === "." || raw === "./") return "";
  if (assertArtifactPathInProject(projectPath, raw) !== null) return null;
  const projectRoot = path.resolve(projectPath);
  return path.relative(projectRoot, path.resolve(projectRoot, raw));
}

function rowExists(db: DatabaseType, table: string, id: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id));
}

function mapRun(row: Record<string, unknown>): PrototypeRunRecord {
  return {
    id: String(row.id),
    run_id: String(row.run_id),
    source_artifact_path: String(row.source_artifact_path),
    prototype_root: String(row.prototype_root),
    dev_command: String(row.dev_command),
    seed_reference_ids: parseJsonStringArray(row.seed_reference_ids_json),
    evidence_version_ids: parseJsonStringArray(row.evidence_version_ids_json),
    design_system_version: String(row.design_system_version),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function mapSurface(row: Record<string, unknown>): PrototypeSurfaceRecord {
  return {
    id: String(row.id),
    prototype_run_id: String(row.prototype_run_id),
    run_id: String(row.run_id ?? ""),
    surface_key: String(row.surface_key),
    name: String(row.name),
    preview_url: String(row.preview_url),
    route_path: String(row.route_path ?? "/"),
    surface_url: composePrototypeSurfaceUrl(
      String(row.preview_url),
      String(row.route_path ?? "/")
    ),
    preview_port: Number(row.preview_port),
    readiness: String(row.readiness) as PreviewReadiness,
    readiness_reason:
      row.readiness_reason === null || row.readiness_reason === undefined
        ? null
        : String(row.readiness_reason),
    stale: Number(row.stale) === 1,
    stale_reason:
      row.stale_reason === null || row.stale_reason === undefined
        ? null
        : String(row.stale_reason),
    screenshot_artifact_path:
      row.screenshot_artifact_path === null ||
      row.screenshot_artifact_path === undefined
        ? null
        : String(row.screenshot_artifact_path),
    screenshot_captured_at:
      row.screenshot_captured_at === null ||
      row.screenshot_captured_at === undefined
        ? null
        : String(row.screenshot_captured_at),
    source_generation: Number(row.source_generation ?? 0),
    screenshot_generation: Number(row.screenshot_generation ?? 0),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

const SURFACE_SELECT = `
  SELECT s.*, r.run_id AS run_id
  FROM prototype_surfaces s
  JOIN prototype_runs r ON r.id = s.prototype_run_id
`;

export function listPrototypeSurfaces(
  projectPath: string
): PrototypeSurfaceRecord[] {
  const db = openProjectDb(projectPath);
  try {
    return (
      db
        .prepare(`${SURFACE_SELECT} ORDER BY s.created_at ASC, s.id ASC`)
        .all() as Array<Record<string, unknown>>
    ).map(mapSurface);
  } finally {
    closeProjectDb(db);
  }
}

export function getPrototypeSurface(
  projectPath: string,
  surfaceId: string
): PrototypeSurfaceRecord | null {
  const db = openProjectDb(projectPath);
  try {
    const row = db
      .prepare(`${SURFACE_SELECT} WHERE s.id = ?`)
      .get(surfaceId) as Record<string, unknown> | undefined;
    return row ? mapSurface(row) : null;
  } finally {
    closeProjectDb(db);
  }
}

/**
 * Persist one readiness transition. `ready` and `failed` are the two states
 * the audit trail cares about, so only those log a lifecycle event.
 */
export function setPreviewReadiness(
  projectPath: string,
  surfaceId: string,
  readiness: PreviewReadiness,
  reason: string | null = null
): { ok: true; event_id: string | null } | { ok: false; reason: string } {
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const row = db
        .prepare(`${SURFACE_SELECT} WHERE s.id = ?`)
        .get(surfaceId) as Record<string, unknown> | undefined;
      if (!row) {
        return { ok: false as const, reason: "surface_record_not_found" };
      }
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE prototype_surfaces
         SET readiness = ?, readiness_reason = ?, updated_at = ?
         WHERE id = ?`
      ).run(readiness, reason, now, surfaceId);

      const surface = mapSurface(row);
      let eventId: string | null = null;
      if (readiness === "ready" || readiness === "failed") {
        const event = logEventOnDb(
          db,
          readiness === "ready" ? "preview_started" : "preview_failed",
          {
            prototype_surface_id: surfaceId,
            prototype_run_id: surface.prototype_run_id,
            run_id: surface.run_id,
            surface_key: surface.surface_key,
            preview_origin: surface.preview_url,
            route_path: surface.route_path,
            preview_url: surface.surface_url,
            readiness,
            ...(reason === null ? {} : { reason })
          }
        );
        eventId = event.event_id;
      }
      return { ok: true as const, event_id: eventId };
    });
    if (result.ok) {
      emitRecordEvent({
        kind: "prototype",
        action: "updated",
        id: surfaceId,
        projectPath: path.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

/**
 * Persist the Runtime-captured preview bitmap for one surface. Fired after a
 * successful capture; the artifact path is project-relative (like
 * evidence-media paths) so the Workbench serves it via /api/artifacts.
 * When `expectedGeneration` is set, the write is a compare-and-set against
 * `source_generation` so a newer watched revision cannot be overwritten.
 */
export function setPrototypeSurfaceScreenshot(
  projectPath: string,
  surfaceId: string,
  artifactPath: string,
  options: { expectedGeneration?: number } = {}
):
  | {
      ok: true;
      event_id: string | null;
      previous_artifact_path: string | null;
    }
  | { ok: false; reason: string } {
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const row = db
        .prepare(`${SURFACE_SELECT} WHERE s.id = ?`)
        .get(surfaceId) as Record<string, unknown> | undefined;
      if (!row) {
        return { ok: false as const, reason: "surface_record_not_found" };
      }
      const surface = mapSurface(row);
      const previousArtifactPath = surface.screenshot_artifact_path;
      const now = new Date().toISOString();
      const screenshotGeneration =
        options.expectedGeneration ?? surface.source_generation;
      const update =
        options.expectedGeneration === undefined
          ? db
              .prepare(
                `UPDATE prototype_surfaces
                 SET screenshot_artifact_path = ?, screenshot_captured_at = ?,
                     screenshot_generation = ?, updated_at = ?
                 WHERE id = ?`
              )
              .run(artifactPath, now, screenshotGeneration, now, surfaceId)
          : db
              .prepare(
                `UPDATE prototype_surfaces
                 SET screenshot_artifact_path = ?, screenshot_captured_at = ?,
                     screenshot_generation = ?, updated_at = ?
                 WHERE id = ? AND source_generation = ?`
              )
              .run(
                artifactPath,
                now,
                screenshotGeneration,
                now,
                surfaceId,
                options.expectedGeneration
              );
      if (update.changes === 0) {
        return { ok: false as const, reason: "generation_mismatch" };
      }
      return {
        ok: true as const,
        event_id: null,
        previous_artifact_path: previousArtifactPath
      };
    });
    if (result.ok) {
      emitRecordEvent({
        kind: "prototype",
        action: "updated",
        id: surfaceId,
        projectPath: path.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

/**
 * Mark a surface stale (dev server exited, prototype code changed). Runtime
 * warns and stops: it never auto-restarts and never deletes the surface.
 * Idempotent — a surface already stale does not log a second event.
 */
export function markPrototypeSurfaceStale(
  projectPath: string,
  surfaceId: string,
  reason: string
): { ok: true; already_stale: boolean } | { ok: false; reason: string } {
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const row = db
        .prepare(`${SURFACE_SELECT} WHERE s.id = ?`)
        .get(surfaceId) as Record<string, unknown> | undefined;
      if (!row) {
        return { ok: false as const, reason: "surface_record_not_found" };
      }
      const surface = mapSurface(row);
      if (surface.stale) return { ok: true as const, already_stale: true };
      markSurfacesStaleOnDb(db, [surface], reason);
      return { ok: true as const, already_stale: false };
    });
    if (result.ok && !result.already_stale) {
      emitRecordEvent({
        kind: "prototype",
        action: "updated",
        id: surfaceId,
        projectPath: path.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

function markSurfacesStaleOnDb(
  db: DatabaseType,
  surfaces: readonly PrototypeSurfaceRecord[],
  reason: string
): string[] {
  const now = new Date().toISOString();
  const update = db.prepare(
    `UPDATE prototype_surfaces
     SET stale = 1, stale_reason = ?, updated_at = ?
     WHERE id = ?`
  );
  const staleIds: string[] = [];
  for (const surface of surfaces) {
    update.run(reason, now, surface.id);
    logEventOnDb(db, "preview_stale", {
      prototype_surface_id: surface.id,
      prototype_run_id: surface.prototype_run_id,
      run_id: surface.run_id,
      surface_key: surface.surface_key,
      preview_origin: surface.preview_url,
      route_path: surface.route_path,
      preview_url: surface.surface_url,
      reason
    });
    staleIds.push(surface.id);
  }
  return staleIds;
}

/**
 * Stale reason for surfaces whose dev server was stopped by a clean Runtime
 * shutdown. Distinct from `code_changed` / `dev_server_exited`: the preview
 * inputs did not change, so the next launch may restore the surface from its
 * persisted run record instead of waiting for an Agent re-declaration.
 */
export const RUNTIME_SHUTDOWN_STALE_REASON = "runtime_shutdown";

/**
 * Runtime is shutting down: every surface claiming a live state goes stale
 * with `runtime_shutdown` (the dev-server children are killed separately via
 * `killAllPreviewServers`). Already-stale surfaces keep their original reason,
 * and `failed` surfaces stay failed — a terminal failure is not restorable.
 */
export function markPrototypeSurfacesStaleForShutdown(
  projectPath: string
): { ok: true; stale_ids: string[] } | { ok: false; reason: string } {
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const rows = db
        .prepare(`${SURFACE_SELECT} WHERE s.stale = 0 AND s.readiness != 'failed'`)
        .all() as Array<Record<string, unknown>>;
      const staleIds = markSurfacesStaleOnDb(
        db,
        rows.map(mapSurface),
        RUNTIME_SHUTDOWN_STALE_REASON
      );
      return { ok: true as const, stale_ids: staleIds };
    });
    if (result.ok) {
      for (const id of result.stale_ids) {
        emitRecordEvent({
          kind: "prototype",
          action: "updated",
          id,
          projectPath: path.resolve(projectPath)
        });
      }
    }
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

/**
 * Restore pass candidates: the surface row plus the run fields needed to
 * respawn its dev server (root + command; the port lives on the surface).
 */
type RestoreCandidate = {
  surface: PrototypeSurfaceRecord;
  prototype_root: string;
  dev_command: string;
};

const RESTORE_CANDIDATE_SELECT = `
  SELECT s.*, r.run_id AS run_id, r.prototype_root AS prototype_root,
         r.dev_command AS dev_command
  FROM prototype_surfaces s
  JOIN prototype_runs r ON r.id = s.prototype_run_id
`;

/**
 * Flip one surface to a fresh restore attempt: `starting`, stale cleared.
 * No lifecycle event — only terminal readiness states enter the audit trail.
 */
function setSurfaceRestoreStarting(
  projectPath: string,
  surfaceId: string
): void {
  try {
    withProjectTransaction(projectPath, (db) => {
      db.prepare(
        `UPDATE prototype_surfaces
         SET readiness = 'starting', readiness_reason = NULL,
             stale = 0, stale_reason = NULL, updated_at = ?
         WHERE id = ?`
      ).run(new Date().toISOString(), surfaceId);
    });
    emitRecordEvent({
      kind: "prototype",
      action: "updated",
      id: surfaceId,
      projectPath: path.resolve(projectPath)
    });
  } catch {
    // Best-effort: the probe / respawn below still reports the terminal state.
  }
}

export interface RestorePrototypePreviewsResult {
  ok: true;
  /** Surfaces whose preview URL still answered — adopted without a respawn. */
  adopted: string[];
  /** Surfaces whose dev server was respawned and became ready. */
  restarted: string[];
  /** Surfaces whose restore attempt ended in a failed readiness. */
  failed: string[];
}

export interface RestorePrototypePreviewsOptions {
  supervisor?: PreviewSupervisorDeps;
  /** Overall budget per respawned surface (ms). */
  timeoutMs?: number;
}

/**
 * Session restore after a Runtime (re)launch. Candidates are surfaces a clean
 * shutdown parked (`runtime_shutdown`) and surfaces an unclean exit left
 * claiming a live state (ready / starting / installing) — anything NOT stale
 * for `code_changed` / `dev_server_exited`, which keep the Issue 30 "never
 * auto-restart" semantics and still require an Agent re-declaration. A
 * `failed` readiness is terminal and is left alone as well.
 *
 * Each candidate is adopted when its stable preview URL still answers, or
 * respawned from its persisted run record (root + command + port) through the
 * same supervisor used by recordPreview, so readiness transitions and the
 * screenshot placeholder behave exactly like a fresh declaration.
 *
 * Never rejects: a DB failure yields an empty pass, so the fire-and-forget
 * Workbench trigger has no unhandled rejection to swallow.
 */
export async function restorePrototypePreviews(
  projectPath: string,
  options: RestorePrototypePreviewsOptions = {}
): Promise<RestorePrototypePreviewsResult> {
  const supervisor = options.supervisor ?? defaultPreviewSupervisorDeps;
  const empty: RestorePrototypePreviewsResult = {
    ok: true,
    adopted: [],
    restarted: [],
    failed: []
  };

  let candidates: RestoreCandidate[];
  try {
    const db = openProjectDb(projectPath);
    try {
      const rows = db.prepare(RESTORE_CANDIDATE_SELECT).all() as Array<
        Record<string, unknown>
      >;
      candidates = rows
        .filter(
          (row) =>
            row.stale_reason === RUNTIME_SHUTDOWN_STALE_REASON ||
            (Number(row.stale) === 0 && row.readiness !== "failed")
        )
        .map((row) => ({
          surface: mapSurface(row),
          prototype_root: String(row.prototype_root),
          dev_command: String(row.dev_command)
        }));
    } finally {
      closeProjectDb(db);
    }
  } catch {
    return empty;
  }

  // Flip synchronously, before the first probe await: a Workbench fetch that
  // triggered this restore already sees honest `starting` rows instead of a
  // dead "ready" iframe.
  for (const candidate of candidates) {
    setSurfaceRestoreStarting(projectPath, candidate.surface.id);
  }

  const adopted: string[] = [];
  const restarted: string[] = [];
  const failed: string[] = [];
  for (const candidate of candidates) {
    const { surface } = candidate;
    // A dev server that survived the previous Runtime is adopted; nothing is
    // respawned for a URL that already answers as the preview.
    if (await supervisor.probeUrl(surface.surface_url)) {
      setPreviewReadiness(projectPath, surface.id, "ready", null);
      registerReadyPreviewRefresh(
        projectPath,
        candidate.prototype_root,
        surface.id,
        surface.surface_url,
        supervisor.probeUrl
      );
      adopted.push(surface.id);
      continue;
    }
    const outcome = await startPreviewServer(
      {
        root: path.join(path.resolve(projectPath), candidate.prototype_root),
        command: candidate.dev_command,
        port: surface.preview_port,
        url: surface.surface_url,
        timeoutMs: options.timeoutMs,
        onReadiness: (readiness, reason) => {
          setPreviewReadiness(projectPath, surface.id, readiness, reason);
          if (readiness === "ready") {
            registerReadyPreviewRefresh(
              projectPath,
              candidate.prototype_root,
              surface.id,
              surface.surface_url,
              supervisor.probeUrl
            );
          }
        },
        onExit: (reason) => {
          stopPrototypePreviewRefresh({
            projectPath,
            prototypeRoot: candidate.prototype_root,
            surfaceId: surface.id
          });
          markPrototypeSurfaceStale(projectPath, surface.id, reason);
        }
      },
      supervisor
    );
    if (outcome.readiness === "ready") restarted.push(surface.id);
    else failed.push(surface.id);
  }
  return { ok: true, adopted, restarted, failed };
}

/** Projects whose previews this Runtime process already tried to restore. */
const restoreAttemptedProjects = new Set<string>();

/**
 * Restore entry point for the Workbench: at most one restore pass per project
 * per Runtime process. Returns the in-flight pass, or null when a pass
 * already ran (callers may fire-and-forget either way).
 */
export function restorePrototypePreviewsOnce(
  projectPath: string,
  options: RestorePrototypePreviewsOptions = {}
): Promise<RestorePrototypePreviewsResult> | null {
  const key = path.resolve(projectPath);
  if (restoreAttemptedProjects.has(key)) return null;
  restoreAttemptedProjects.add(key);
  return restorePrototypePreviews(projectPath, options);
}

/** Clear the once-per-process restore gate between tests. */
export function resetPrototypePreviewRestoreForTests(): void {
  restoreAttemptedProjects.clear();
}

/**
 * Prototype code changed. When an active preview watcher already covers the
 * path, keep the surface live and let Runtime recapture; otherwise every live
 * surface whose run covers the declared artifact goes stale. Called from the
 * source-artifact declaration transaction so the warning (or refresh queue)
 * lands with the change that caused it.
 */
export function applyPrototypeCodeChangeOnDb(
  db: DatabaseType,
  projectPath: string,
  relativeArtifactPath: string
): { staleIds: string[]; refreshIds: string[] } {
  const rows = db
    .prepare(`${SURFACE_SELECT} WHERE s.stale = 0`)
    .all() as Array<Record<string, unknown>>;
  if (rows.length === 0) return { staleIds: [], refreshIds: [] };

  const roots = new Map(
    (
      db
        .prepare(`SELECT id, prototype_root FROM prototype_runs`)
        .all() as Array<{ id: string; prototype_root: string }>
    ).map((row) => [row.id, row.prototype_root])
  );
  const affected = rows.map(mapSurface).filter((surface) => {
    const root = roots.get(surface.prototype_run_id) ?? "";
    if (root === "") return true;
    return (
      relativeArtifactPath === root ||
      relativeArtifactPath.startsWith(`${root}${path.sep}`) ||
      relativeArtifactPath.startsWith(`${root}/`)
    );
  });
  if (affected.length === 0) return { staleIds: [], refreshIds: [] };

  const covered = isPrototypePreviewRefreshActive(
    projectPath,
    relativeArtifactPath
  );
  if (covered) {
    return { staleIds: [], refreshIds: affected.map((surface) => surface.id) };
  }
  return {
    staleIds: markSurfacesStaleOnDb(db, affected, "code_changed"),
    refreshIds: []
  };
}

/** @deprecated Prefer applyPrototypeCodeChangeOnDb — kept for existing tests. */
export function markPrototypeSurfacesStaleForArtifactOnDb(
  db: DatabaseType,
  relativeArtifactPath: string
): string[] {
  return applyPrototypeCodeChangeOnDb(db, "", relativeArtifactPath).staleIds;
}

export function queuePrototypeSurfaceRefreshAfterArtifact(
  projectPath: string,
  surfaceIds: readonly string[]
): void {
  refreshCoveredPrototypeSurfacesAfterArtifact(projectPath, surfaceIds);
}

function surfacesByIdsOnDb(
  db: DatabaseType,
  surfaceIds: readonly string[]
): PrototypeSurfaceRecord[] {
  if (surfaceIds.length === 0) return [];
  const placeholders = surfaceIds.map(() => "?").join(", ");
  return (
    db
      .prepare(`${SURFACE_SELECT} WHERE s.id IN (${placeholders})`)
      .all(...surfaceIds) as Array<Record<string, unknown>>
  ).map(mapSurface);
}

function bumpReadySurfacesOnDb(
  db: DatabaseType,
  surfaces: readonly PrototypeSurfaceRecord[]
): Array<{ id: string; surface_url: string; generation: number }> {
  const now = new Date().toISOString();
  const bump = db.prepare(
    `UPDATE prototype_surfaces
     SET source_generation = source_generation + 1, updated_at = ?
     WHERE id = ? AND stale = 0 AND readiness = 'ready'`
  );
  const targets: Array<{ id: string; surface_url: string; generation: number }> =
    [];
  for (const surface of surfaces) {
    const result = bump.run(now, surface.id);
    if (result.changes === 0) continue;
    const row = db
      .prepare(`${SURFACE_SELECT} WHERE s.id = ?`)
      .get(surface.id) as Record<string, unknown> | undefined;
    if (!row) continue;
    const mapped = mapSurface(row);
    targets.push({
      id: mapped.id,
      surface_url: mapped.surface_url,
      generation: mapped.source_generation
    });
  }
  return targets;
}

export function bumpPrototypeSurfaceSourceGeneration(
  projectPath: string,
  prototypeRoot: string
): Array<{ id: string; surface_url: string; generation: number }> {
  try {
    return withProjectTransaction(projectPath, (db) => {
      const rows = db
        .prepare(
          `${RESTORE_CANDIDATE_SELECT}
           WHERE s.stale = 0 AND s.readiness = 'ready' AND r.prototype_root = ?`
        )
        .all(prototypeRoot) as Array<Record<string, unknown>>;
      return bumpReadySurfacesOnDb(db, rows.map(mapSurface));
    });
  } catch {
    return [];
  }
}

export function bumpPrototypeSurfaceSourceGenerationForIds(
  projectPath: string,
  surfaceIds: readonly string[]
): Array<{ id: string; surface_url: string; generation: number }> {
  if (surfaceIds.length === 0) return [];
  try {
    return withProjectTransaction(projectPath, (db) => {
      return bumpReadySurfacesOnDb(db, surfacesByIdsOnDb(db, surfaceIds));
    });
  } catch {
    return [];
  }
}

export function listPrototypeSurfaceUrls(
  projectPath: string,
  surfaceIds: readonly string[]
): Array<{ id: string; surface_url: string }> {
  if (surfaceIds.length === 0) return [];
  const db = openProjectDb(projectPath);
  try {
    return surfacesByIdsOnDb(db, surfaceIds).map((surface) => ({
      id: surface.id,
      surface_url: surface.surface_url
    }));
  } finally {
    closeProjectDb(db);
  }
}

function previewRefreshHost(
  probeUrl: PreviewSupervisorDeps["probeUrl"]
): Partial<PrototypePreviewRefreshHost> {
  return {
    probeUrl,
    bumpGeneration: bumpPrototypeSurfaceSourceGeneration,
    bumpGenerationForIds: bumpPrototypeSurfaceSourceGenerationForIds,
    listSurfaceUrls: listPrototypeSurfaceUrls,
    markStale(nextProjectPath, surfaceId, reason) {
      markPrototypeSurfaceStale(nextProjectPath, surfaceId, reason);
    },
    logFailure(nextProjectPath, surfaceId, previewUrl, reason) {
      logEvent(nextProjectPath, "preview_screenshot_failed", {
        prototype_surface_id: surfaceId,
        preview_url: previewUrl,
        reason
      });
    }
  };
}

function registerReadyPreviewRefresh(
  projectPath: string,
  prototypeRoot: string,
  surfaceId: string,
  surfaceUrl: string,
  probeUrl: PreviewSupervisorDeps["probeUrl"]
): void {
  startPrototypePreviewRefresh({
    projectPath,
    prototypeRoot,
    surfaceId,
    host: previewRefreshHost(probeUrl)
  });
  const surface = getPrototypeSurface(projectPath, surfaceId);
  void capturePrototypeSurfaceScreenshot(
    projectPath,
    surfaceId,
    surfaceUrl,
    undefined,
    { expectedGeneration: surface?.source_generation ?? 0 }
  );
}

type UpsertOutcome = {
  run: PrototypeRunRecord;
  surface: PrototypeSurfaceRecord;
  created: boolean;
};

/**
 * Create or update the run + surface pair for one preview declaration, then
 * hand the surface to the Runtime dev-server supervisor. Returns after the
 * readiness attempt settles (ready / failed) or its budget expires — the tool
 * call never hangs waiting on npm.
 */
export async function recordPreview(
  projectPath: string,
  input: RecordPreviewInput,
  options: RecordPreviewOptions = {}
): Promise<RecordPreviewResult> {
  const supervisor = options.supervisor ?? defaultPreviewSupervisorDeps;

  const runId = trimmed(input.runId);
  const sourceArtifactPath = trimmed(input.sourceArtifactPath);
  const routePath = normalizePrototypeRoutePath(input.routePath);
  const surfaceKey = trimmed(input.surfaceKey) || DEFAULT_SURFACE_KEY;
  const name = trimmed(input.name) || surfaceKey;
  const devCommand = trimmed(input.devCommand) || DEFAULT_DEV_COMMAND;
  const seedReferenceIds = idList(input.seedReferenceIds);
  const evidenceVersionIds = idList(input.evidenceVersionIds);
  if (
    runId.length === 0 ||
    sourceArtifactPath.length === 0 ||
    routePath === null ||
    seedReferenceIds === null ||
    evidenceVersionIds === null
  ) {
    return { ok: false, reason: "invalid_preview" };
  }
  // Runtime owns the shell (spawn with shell: true); the Agent may only name
  // a package-manager script, never compose a command line.
  if (!isAllowedDevCommand(devCommand)) {
    return { ok: false, reason: "dev_command_not_allowed" };
  }

  const gate = requireProjectPhase(projectPath, PREVIEW_ALLOWED_PHASES);
  if (!gate.ok) return { ok: false, reason: "phase_gate", phase: gate.phase };

  const prototypeRoot = normalizePrototypeRoot(
    projectPath,
    input.prototypeRoot
  );
  if (prototypeRoot === null) {
    return { ok: false, reason: "artifact_path_escape" };
  }

  // Seed reconstruction (the prototype_validation phase) must name the seed
  // evidence it reconstructs; later phases build on the formalized system.
  if (
    gate.phase === "prototype_validation" &&
    (seedReferenceIds.length === 0 || evidenceVersionIds.length === 0)
  ) {
    return { ok: false, reason: "missing_seed_evidence" };
  }

  let takenPorts: number[] = [];
  let existingPort: number | null = null;
  try {
    const db = openProjectDb(projectPath);
    try {
      takenPorts = (
        db
          .prepare(`SELECT preview_port FROM prototype_surfaces`)
          .all() as Array<{ preview_port: number }>
      ).map((row) => Number(row.preview_port));
      const existing = db
        .prepare(
          `SELECT s.preview_port AS preview_port
           FROM prototype_surfaces s
           JOIN prototype_runs r ON r.id = s.prototype_run_id
           WHERE r.run_id = ? AND s.surface_key = ?`
        )
        .get(runId, surfaceKey) as { preview_port: number } | undefined;
      existingPort = existing ? Number(existing.preview_port) : null;
    } finally {
      closeProjectDb(db);
    }
  } catch {
    return { ok: false, reason: "db_error" };
  }

  // A surface keeps the port it was first given, so its preview URL is stable
  // across restarts and re-declarations.
  const port =
    existingPort ?? (await allocatePreviewPort(takenPorts, supervisor));
  if (port === null) {
    return { ok: false, reason: "no_available_preview_port" };
  }
  const previewUrl = previewUrlForPort(port);
  const surfaceUrl = composePrototypeSurfaceUrl(previewUrl, routePath);

  let upserted: UpsertOutcome;
  try {
    const transaction = withProjectTransaction(projectPath, (db) => {
      const artifact = db
        .prepare(
          `SELECT artifact_type FROM source_artifacts WHERE path = ?`
        )
        .get(sourceArtifactPath) as { artifact_type: string } | undefined;
      if (
        !artifact ||
        (artifact.artifact_type !== "prototype" &&
          artifact.artifact_type !== "code")
      ) {
        return {
          ok: false as const,
          reason: "prototype_artifact_not_declared" as const
        };
      }
      for (const id of seedReferenceIds) {
        if (!rowExists(db, "seed_references", id)) {
          return {
            ok: false as const,
            reason: "linkage_record_not_found" as const
          };
        }
      }
      // Evidence version identity is the Figma Evidence Surface row id.
      for (const id of evidenceVersionIds) {
        if (!rowExists(db, "figma_evidence_surfaces", id)) {
          return {
            ok: false as const,
            reason: "linkage_record_not_found" as const
          };
        }
      }

      const now = new Date().toISOString();
      const existingRun = db
        .prepare(`SELECT * FROM prototype_runs WHERE run_id = ?`)
        .get(runId) as Record<string, unknown> | undefined;
      const runRowId = existingRun ? String(existingRun.id) : randomUUID();
      const run: PrototypeRunRecord = {
        id: runRowId,
        run_id: runId,
        source_artifact_path: sourceArtifactPath,
        prototype_root: prototypeRoot,
        dev_command: devCommand,
        seed_reference_ids: seedReferenceIds,
        evidence_version_ids: evidenceVersionIds,
        design_system_version: designSystemVersionOnDb(db),
        created_at: existingRun ? String(existingRun.created_at) : now,
        updated_at: now
      };
      if (existingRun) {
        db.prepare(
          `UPDATE prototype_runs
           SET source_artifact_path = ?, prototype_root = ?, dev_command = ?,
               seed_reference_ids_json = ?, evidence_version_ids_json = ?,
               design_system_version = ?, updated_at = ?
           WHERE id = ?`
        ).run(
          run.source_artifact_path,
          run.prototype_root,
          run.dev_command,
          JSON.stringify(run.seed_reference_ids),
          JSON.stringify(run.evidence_version_ids),
          run.design_system_version,
          run.updated_at,
          run.id
        );
      } else {
        db.prepare(
          `INSERT INTO prototype_runs (
             id, run_id, source_artifact_path, prototype_root, dev_command,
             seed_reference_ids_json, evidence_version_ids_json,
             design_system_version, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          run.id,
          run.run_id,
          run.source_artifact_path,
          run.prototype_root,
          run.dev_command,
          JSON.stringify(run.seed_reference_ids),
          JSON.stringify(run.evidence_version_ids),
          run.design_system_version,
          run.created_at,
          run.updated_at
        );
      }

      const existingSurface = db
        .prepare(
          `SELECT * FROM prototype_surfaces
           WHERE prototype_run_id = ? AND surface_key = ?`
        )
        .get(run.id, surfaceKey) as Record<string, unknown> | undefined;
      const surface: PrototypeSurfaceRecord = {
        id: existingSurface ? String(existingSurface.id) : randomUUID(),
        prototype_run_id: run.id,
        run_id: run.run_id,
        surface_key: surfaceKey,
        name,
        preview_url: previewUrl,
        route_path: routePath,
        surface_url: surfaceUrl,
        preview_port: port,
        readiness: "starting",
        readiness_reason: null,
        // Re-declaring a preview is the designer-visible "it changed" moment:
        // the surface starts fresh instead of inheriting an old stale warning.
        stale: false,
        stale_reason: null,
        // The UPDATE keeps the previously captured bitmap; it stays as the
        // placeholder until the new readiness → screenshot round replaces it.
        screenshot_artifact_path:
          existingSurface === undefined ||
          existingSurface.screenshot_artifact_path === null ||
          existingSurface.screenshot_artifact_path === undefined
            ? null
            : String(existingSurface.screenshot_artifact_path),
        screenshot_captured_at:
          existingSurface === undefined ||
          existingSurface.screenshot_captured_at === null ||
          existingSurface.screenshot_captured_at === undefined
            ? null
            : String(existingSurface.screenshot_captured_at),
        source_generation: Number(existingSurface?.source_generation ?? 0),
        screenshot_generation: Number(
          existingSurface?.screenshot_generation ?? 0
        ),
        created_at: existingSurface ? String(existingSurface.created_at) : now,
        updated_at: now
      };
      if (existingSurface) {
        db.prepare(
          `UPDATE prototype_surfaces
           SET name = ?, preview_url = ?, route_path = ?, preview_port = ?, readiness = ?,
               readiness_reason = NULL, stale = 0, stale_reason = NULL,
               updated_at = ?
           WHERE id = ?`
        ).run(
          surface.name,
          surface.preview_url,
          surface.route_path,
          surface.preview_port,
          surface.readiness,
          surface.updated_at,
          surface.id
        );
      } else {
        db.prepare(
          `INSERT INTO prototype_surfaces (
             id, prototype_run_id, surface_key, name, preview_url, route_path,
             preview_port, readiness, readiness_reason, stale, stale_reason,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?, ?)`
        ).run(
          surface.id,
          surface.prototype_run_id,
          surface.surface_key,
          surface.name,
          surface.preview_url,
          surface.route_path,
          surface.preview_port,
          surface.readiness,
          surface.created_at,
          surface.updated_at
        );
      }

      // Record + event in the same transaction: the run/surface declaration
      // must exist in the canonical event log, not just the record tables.
      logEventOnDb(db, "prototype_preview_declared", {
        run_id: run.run_id,
        prototype_run_id: run.id,
        prototype_surface_id: surface.id,
        surface_key: surface.surface_key,
        action: existingSurface === undefined ? "created" : "updated",
        run_created: existingRun === undefined,
        source_artifact_path: run.source_artifact_path,
        prototype_root: run.prototype_root,
        seed_reference_ids: run.seed_reference_ids,
        evidence_version_ids: run.evidence_version_ids,
        design_system_version: run.design_system_version,
        preview_origin: surface.preview_url,
        route_path: surface.route_path,
        preview_url: surface.surface_url,
        preview_port: surface.preview_port
      });

      return {
        ok: true as const,
        run,
        surface,
        created: existingSurface === undefined
      };
    });
    if (!transaction.ok) {
      return { ok: false, reason: transaction.reason };
    }
    upserted = transaction;
  } catch {
    return { ok: false, reason: "db_error" };
  }

  emitRecordEvent({
    kind: "prototype",
    action: upserted.created ? "created" : "updated",
    id: upserted.surface.id,
    projectPath: path.resolve(projectPath)
  });

  const lifecycle: { eventId: string | null } = { eventId: null };
  const outcome = await startPreviewServer(
    {
      root: path.join(path.resolve(projectPath), upserted.run.prototype_root),
      command: upserted.run.dev_command,
      port,
      url: surfaceUrl,
      timeoutMs: options.timeoutMs,
      onReadiness: (readiness, reason) => {
        const applied = setPreviewReadiness(
          projectPath,
          upserted.surface.id,
          readiness,
          reason
        );
        if (applied.ok && applied.event_id) lifecycle.eventId = applied.event_id;
        // Screenshot placeholder (Issue 30): once the preview answers, capture
        // a bitmap so non-live surfaces show the page instead of text. Both
        // ready paths (normal probe and occupied-port probe) flow through this
        // same callback. Fire-and-forget — the tool call must never block on
        // a headless browser, and a failed capture leaves the old bitmap.
        if (readiness === "ready") {
          registerReadyPreviewRefresh(
            projectPath,
            upserted.run.prototype_root,
            upserted.surface.id,
            surfaceUrl,
            supervisor.probeUrl
          );
        }
      },
      onExit: (reason) => {
        stopPrototypePreviewRefresh({
          projectPath,
          prototypeRoot: upserted.run.prototype_root,
          surfaceId: upserted.surface.id
        });
        markPrototypeSurfaceStale(projectPath, upserted.surface.id, reason);
      }
    },
    supervisor
  );

  const surface = getPrototypeSurface(projectPath, upserted.surface.id);
  return {
    ok: true,
    run: upserted.run,
    surface: surface ?? {
      ...upserted.surface,
      readiness: outcome.readiness,
      readiness_reason: outcome.reason
    },
    readiness: outcome.readiness,
    preview_url: surfaceUrl,
    event_id: lifecycle.eventId
  };
}
