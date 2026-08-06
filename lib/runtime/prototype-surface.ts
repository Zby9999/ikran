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
import { logEventOnDb } from "./events";
import { emitRecordEvent } from "./record-bus";
import { assertArtifactPathInProject } from "./evidence-package";
import { requireProjectPhase, type ProjectPhase } from "./project-phase";
import {
  allocatePreviewPort,
  defaultPreviewSupervisorDeps,
  previewUrlForPort,
  startPreviewServer,
  type PreviewReadiness,
  type PreviewSupervisorDeps
} from "./preview-server";

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
  preview_url: string;
  preview_port: number;
  readiness: PreviewReadiness;
  readiness_reason: string | null;
  stale: boolean;
  stale_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecordPreviewInput {
  /** Run grouping marker, shared with designer feedback aggregation. */
  runId: string;
  /** Declared prototype/code artifact this preview was built from. */
  sourceArtifactPath: string;
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
    seed_reference_ids: parseIdsJson(row.seed_reference_ids_json),
    evidence_version_ids: parseIdsJson(row.evidence_version_ids_json),
    design_system_version: String(row.design_system_version),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function parseIdsJson(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}

function mapSurface(row: Record<string, unknown>): PrototypeSurfaceRecord {
  return {
    id: String(row.id),
    prototype_run_id: String(row.prototype_run_id),
    run_id: String(row.run_id ?? ""),
    surface_key: String(row.surface_key),
    name: String(row.name),
    preview_url: String(row.preview_url),
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
            preview_url: surface.preview_url,
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
      preview_url: surface.preview_url,
      reason
    });
    staleIds.push(surface.id);
  }
  return staleIds;
}

/**
 * Prototype code changed: every live surface whose run covers the declared
 * artifact goes stale. Called from the source-artifact declaration
 * transaction so the warning lands with the change that caused it, without a
 * filesystem watcher.
 */
export function markPrototypeSurfacesStaleForArtifactOnDb(
  db: DatabaseType,
  relativeArtifactPath: string
): string[] {
  const rows = db
    .prepare(`${SURFACE_SELECT} WHERE s.stale = 0`)
    .all() as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

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
  if (affected.length === 0) return [];
  return markSurfacesStaleOnDb(db, affected, "code_changed");
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
  const surfaceKey = trimmed(input.surfaceKey) || DEFAULT_SURFACE_KEY;
  const name = trimmed(input.name) || surfaceKey;
  const devCommand = trimmed(input.devCommand) || DEFAULT_DEV_COMMAND;
  const seedReferenceIds = idList(input.seedReferenceIds);
  const evidenceVersionIds = idList(input.evidenceVersionIds);
  if (
    runId.length === 0 ||
    sourceArtifactPath.length === 0 ||
    seedReferenceIds === null ||
    evidenceVersionIds === null
  ) {
    return { ok: false, reason: "invalid_preview" };
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
        preview_port: port,
        readiness: "starting",
        readiness_reason: null,
        // Re-declaring a preview is the designer-visible "it changed" moment:
        // the surface starts fresh instead of inheriting an old stale warning.
        stale: false,
        stale_reason: null,
        created_at: existingSurface ? String(existingSurface.created_at) : now,
        updated_at: now
      };
      if (existingSurface) {
        db.prepare(
          `UPDATE prototype_surfaces
           SET name = ?, preview_url = ?, preview_port = ?, readiness = ?,
               readiness_reason = NULL, stale = 0, stale_reason = NULL,
               updated_at = ?
           WHERE id = ?`
        ).run(
          surface.name,
          surface.preview_url,
          surface.preview_port,
          surface.readiness,
          surface.updated_at,
          surface.id
        );
      } else {
        db.prepare(
          `INSERT INTO prototype_surfaces (
             id, prototype_run_id, surface_key, name, preview_url,
             preview_port, readiness, readiness_reason, stale, stale_reason,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?, ?)`
        ).run(
          surface.id,
          surface.prototype_run_id,
          surface.surface_key,
          surface.name,
          surface.preview_url,
          surface.preview_port,
          surface.readiness,
          surface.created_at,
          surface.updated_at
        );
      }

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
      url: previewUrl,
      timeoutMs: options.timeoutMs,
      onReadiness: (readiness, reason) => {
        const applied = setPreviewReadiness(
          projectPath,
          upserted.surface.id,
          readiness,
          reason
        );
        if (applied.ok && applied.event_id) lifecycle.eventId = applied.event_id;
      },
      onExit: (reason) => {
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
    preview_url: previewUrl,
    event_id: lifecycle.eventId
  };
}
