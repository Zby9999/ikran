// Lifecycle for Runtime-owned Figma screenshot media.
//
// Canonical Evidence Surface metadata and lineage stay in SQLite. Image bytes
// live in project-local artifacts so list/read endpoints never duplicate large
// base64 payloads through SQLite and JSON. Superseded media is retained for a
// short recovery window, then its DB references and Runtime-owned file are
// removed while the Surface row remains auditable.

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import { closeProjectDb, openProjectDb } from "./db";
import { getArtifactsDir, getIkranDir } from "./paths";

export const EVIDENCE_MEDIA_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const EVIDENCE_MEDIA_PROVISIONAL_GRACE_MS = 5 * 60 * 1_000;

const MANAGED_MEDIA_DIR_NAME = "evidence-media";
const RETENTION_MARKER_NAME = "evidence-media-retention-v1.json";
const VACUUM_MARKER_NAME = "evidence-media-vacuum-v1.json";
const DELETION_QUEUE_NAME = "evidence-media-deletions-v1.json";
const RETRY_DELAY_MS = 60_000;
const DATA_URL_RE =
  /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/]+=*)$/i;

type SurfaceMediaRow = {
  id: string;
  screenshot_artifact_path: string | null;
  screenshot_data_url: string | null;
  superseded_by: string | null;
  superseded_at: string | null;
};

type PendingDeletion = {
  surface_id: string;
  artifact_path: string;
  not_before_ms?: number;
};

const maintenanceTimers = new Map<string, NodeJS.Timeout>();

function withImmediateProjectTransaction<T>(
  projectPath: string,
  fn: (db: DatabaseType) => T
): T {
  const db = openProjectDb(projectPath);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn(db);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Original failure is authoritative.
      }
      throw error;
    }
  } finally {
    closeProjectDb(db);
  }
}

export type EvidenceMediaMaintenanceResult = {
  bootstrapped: boolean;
  materialized: number;
  purged: number;
  vacuumed: boolean;
};

export function getEvidenceMediaMarkerPath(projectPath: string): string {
  return path.join(getIkranDir(projectPath), RETENTION_MARKER_NAME);
}

function getVacuumMarkerPath(projectPath: string): string {
  return path.join(getIkranDir(projectPath), VACUUM_MARKER_NAME);
}

function getDeletionQueuePath(projectPath: string): string {
  return path.join(getIkranDir(projectPath), DELETION_QUEUE_NAME);
}

function getManagedMediaDir(projectPath: string): string {
  return path.join(getArtifactsDir(projectPath), MANAGED_MEDIA_DIR_NAME);
}

function surfaceFileStem(surfaceId: string): string {
  return encodeURIComponent(surfaceId);
}

function managedRelativePath(surfaceId: string, extension: string): string {
  return path.posix.join(
    ".ikran",
    "artifacts",
    MANAGED_MEDIA_DIR_NAME,
    `${surfaceFileStem(surfaceId)}.${extension}`
  );
}

export function isManagedEvidenceArtifactPath(
  artifactPath: string,
  surfaceId: string
): boolean {
  const normalized = artifactPath.replaceAll("\\", "/");
  const match = new RegExp(
    `^\\.ikran/artifacts/${MANAGED_MEDIA_DIR_NAME}/([^/]+)\\.(png|jpg|webp|gif)$`,
    "i"
  ).exec(normalized);
  return (
    match !== null &&
    match[1] === surfaceFileStem(surfaceId)
  );
}

function assertContainedDirectory(
  projectPath: string,
  directory: string
): string {
  const projectRoot = realpathSync(projectPath);
  const realDirectory = realpathSync(directory);
  const relative = path.relative(projectRoot, realDirectory);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Evidence media directory escapes project: ${directory}`);
  }
  return realDirectory;
}

function decodeScreenshotDataUrl(dataUrl: string): {
  bytes: Buffer;
  extension: string;
} {
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) {
    throw new Error("Invalid evidence screenshot data URL");
  }
  const subtype = match[1].toLowerCase();
  return {
    bytes: Buffer.from(match[2], "base64"),
    extension: subtype === "jpeg" || subtype === "jpg" ? "jpg" : subtype
  };
}

/** Write one Runtime-owned screenshot and return its project-relative path. */
export function persistEvidenceScreenshot(
  projectPath: string,
  surfaceId: string,
  dataUrl: string
): string {
  const decoded = decodeScreenshotDataUrl(dataUrl);
  const directory = getManagedMediaDir(projectPath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const realDirectory = assertContainedDirectory(projectPath, directory);

  const relativePath = managedRelativePath(surfaceId, decoded.extension);
  // Register ownership before bytes hit disk. If the process exits before the
  // Surface transaction commits, the next maintenance pass sees no matching
  // DB reference and removes this provisional artifact.
  enqueueEvidenceArtifactDeletions(projectPath, [
    {
      surface_id: surfaceId,
      artifact_path: relativePath,
      not_before_ms: Date.now() + EVIDENCE_MEDIA_PROVISIONAL_GRACE_MS
    }
  ]);
  const absolutePath = path.join(
    realDirectory,
    `${surfaceFileStem(surfaceId)}.${decoded.extension}`
  );
  if (existsSync(absolutePath)) {
    const existing = readFileSync(absolutePath);
    if (!existing.equals(decoded.bytes)) {
      throw new Error(`Evidence media path collision for ${surfaceId}`);
    }
    return relativePath;
  }

  const tempPath = path.join(directory, `.${surfaceId}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, decoded.bytes, { flag: "wx", mode: 0o600 });
    renameSync(tempPath, absolutePath);
  } finally {
    rmSync(tempPath, { force: true });
  }
  return relativePath;
}

/** Delete only artifacts owned by this lifecycle; never unlink user paths. */
export function removeManagedEvidenceArtifact(
  projectPath: string,
  artifactPath: string | null,
  surfaceId: string
): boolean {
  if (!artifactPath || !isManagedEvidenceArtifactPath(artifactPath, surfaceId)) {
    return true;
  }
  try {
    const directory = getManagedMediaDir(projectPath);
    if (!existsSync(directory)) return true;
    const realDirectory = assertContainedDirectory(projectPath, directory);
    const absolutePath = path.join(realDirectory, path.basename(artifactPath));
    rmSync(absolutePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  const parent = path.dirname(filePath);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(value)}\n`, {
      flag: "wx",
      mode: 0o600
    });
    renameSync(tempPath, filePath);
  } finally {
    rmSync(tempPath, { force: true });
  }
}

function writeMarker(projectPath: string, markerPath: string): void {
  const ikranDir = getIkranDir(projectPath);
  mkdirSync(ikranDir, { recursive: true, mode: 0o700 });
  assertContainedDirectory(projectPath, ikranDir);
  writeJsonAtomically(markerPath, {
    version: 1,
    completed_at: new Date().toISOString()
  });
}

function readPendingDeletions(projectPath: string): PendingDeletion[] {
  const queuePath = getDeletionQueuePath(projectPath);
  if (!existsSync(queuePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(queuePath, "utf8")) as {
      version?: unknown;
      pending?: unknown;
    };
    if (parsed.version !== 1 || !Array.isArray(parsed.pending)) return [];
    return parsed.pending.filter(
      (entry): entry is PendingDeletion =>
        entry !== null &&
        typeof entry === "object" &&
        typeof (entry as PendingDeletion).surface_id === "string" &&
        typeof (entry as PendingDeletion).artifact_path === "string" &&
        ((entry as PendingDeletion).not_before_ms === undefined ||
          typeof (entry as PendingDeletion).not_before_ms === "number")
    );
  } catch {
    return [];
  }
}

export function enqueueEvidenceArtifactDeletions(
  projectPath: string,
  entries: PendingDeletion[]
): void {
  const managedEntries = entries.filter((entry) =>
    isManagedEvidenceArtifactPath(entry.artifact_path, entry.surface_id)
  );
  if (managedEntries.length === 0) return;
  const byKey = new Map<string, PendingDeletion>();
  for (const entry of [...readPendingDeletions(projectPath), ...managedEntries]) {
    const key = `${entry.surface_id}\0${entry.artifact_path}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entry);
      continue;
    }
    const existingNotBefore = existing.not_before_ms ?? 0;
    const incomingNotBefore = entry.not_before_ms ?? 0;
    byKey.set(
      key,
      incomingNotBefore < existingNotBefore ? entry : existing
    );
  }
  writeJsonAtomically(getDeletionQueuePath(projectPath), {
    version: 1,
    pending: [...byKey.values()]
  });
}

/** Retry deletions only after the corresponding DB reference no longer exists. */
export function processPendingEvidenceArtifactDeletions(
  projectPath: string
): boolean {
  const pending = readPendingDeletions(projectPath);
  if (pending.length === 0) return false;
  const db = openProjectDb(projectPath);
  const remaining: PendingDeletion[] = [];
  let retryNeeded = false;
  try {
    const lookup = db.prepare(
      `SELECT screenshot_artifact_path
       FROM figma_evidence_surfaces WHERE id = ?`
    );
    for (const entry of pending) {
      const row = lookup.get(entry.surface_id) as
        | { screenshot_artifact_path: string | null }
        | undefined;
      if (row?.screenshot_artifact_path === entry.artifact_path) {
        remaining.push(entry);
        continue;
      }
      if ((entry.not_before_ms ?? 0) > Date.now()) {
        remaining.push(entry);
        retryNeeded = true;
        continue;
      }
      if (
        !removeManagedEvidenceArtifact(
          projectPath,
          entry.artifact_path,
          entry.surface_id
        )
      ) {
        remaining.push(entry);
        retryNeeded = true;
      }
    }
  } finally {
    closeProjectDb(db);
  }
  writeJsonAtomically(getDeletionQueuePath(projectPath), {
    version: 1,
    pending: remaining
  });
  return retryNeeded;
}

export function discardManagedEvidenceArtifact(
  projectPath: string,
  artifactPath: string | null,
  surfaceId: string
): void {
  if (!artifactPath) return;
  try {
    enqueueEvidenceArtifactDeletions(projectPath, [
      { surface_id: surfaceId, artifact_path: artifactPath }
    ]);
    // The queue processor checks committed DB ownership first. This prevents a
    // losing concurrent maintenance transaction from deleting the file that a
    // winning transaction now references.
    const retryNeeded = processPendingEvidenceArtifactDeletions(projectPath);
    if (retryNeeded) {
      scheduleEvidenceMediaMaintenance(
        projectPath,
        Date.now() + RETRY_DELAY_MS
      );
    }
  } catch {
    // A cleanup failure must not replace the canonical transaction result.
    // Leaving an unreferenced managed file is safer than deleting a live one.
  }
}

function writeRetentionMarker(projectPath: string): void {
  const markerPath = getEvidenceMediaMarkerPath(projectPath);
  mkdirSync(path.dirname(markerPath), { recursive: true });
  writeMarker(projectPath, markerPath);
}

function scheduleEvidenceMediaMaintenance(
  projectPath: string,
  expiresAtMs: number | null
): void {
  const key = path.resolve(projectPath);
  const existing = maintenanceTimers.get(key);
  if (existing) clearTimeout(existing);
  maintenanceTimers.delete(key);
  if (expiresAtMs === null) return;

  const delay = Math.max(0, Math.min(2_147_483_647, expiresAtMs - Date.now()));
  const timer = setTimeout(() => {
    maintenanceTimers.delete(key);
    try {
      maintainEvidenceMedia(key);
    } catch {
      scheduleEvidenceMediaMaintenance(key, Date.now() + RETRY_DELAY_MS);
    }
  }, delay);
  timer.unref();
  maintenanceTimers.set(key, timer);
}

/**
 * Apply media retention and migrate legacy inline screenshots.
 *
 * A project without the v1 marker is legacy: all already-superseded media is
 * purged immediately, current inline media is externalized, and SQLite is
 * compacted once. Afterwards, normal maintenance keeps superseded media for
 * 24 hours based on the successor Surface's creation timestamp.
 */
export function maintainEvidenceMedia(
  projectPath: string,
  options: { now?: Date } = {}
): EvidenceMediaMaintenanceResult {
  const markerPath = getEvidenceMediaMarkerPath(projectPath);
  const bootstrapped = !existsSync(markerPath);
  const vacuumMarkerPath = getVacuumMarkerPath(projectPath);
  const vacuumPending = !existsSync(vacuumMarkerPath);
  const cutoff = new Date(
    (options.now ?? new Date()).getTime() - EVIDENCE_MEDIA_RETENTION_MS
  ).toISOString();
  const createdArtifacts: PendingDeletion[] = [];
  const artifactsToDelete: PendingDeletion[] = [];

  let materialized = 0;
  let purged = 0;
  let nextExpiryMs: number | null = null;
  let retryNeeded = processPendingEvidenceArtifactDeletions(projectPath);
  try {
    withImmediateProjectTransaction(projectPath, (db) => {
      const rows = db
        .prepare(
          `SELECT surface.id,
                  surface.screenshot_artifact_path,
                  surface.screenshot_data_url,
                  surface.superseded_by,
                  successor.created_at AS superseded_at
           FROM figma_evidence_surfaces AS surface
           LEFT JOIN figma_evidence_surfaces AS successor
             ON successor.id = surface.superseded_by
           WHERE surface.screenshot_artifact_path IS NOT NULL
              OR surface.screenshot_data_url IS NOT NULL`
        )
        .all() as SurfaceMediaRow[];

      for (const row of rows) {
        const expired =
          row.superseded_by !== null &&
          (bootstrapped ||
            (row.superseded_at !== null && row.superseded_at <= cutoff));

        if (!expired && row.superseded_at !== null) {
          const expiresAt =
            new Date(row.superseded_at).getTime() + EVIDENCE_MEDIA_RETENTION_MS;
          if (
            Number.isFinite(expiresAt) &&
            (nextExpiryMs === null || expiresAt < nextExpiryMs)
          ) {
            nextExpiryMs = expiresAt;
          }
        }

        if (expired) {
          db.prepare(
            `UPDATE figma_evidence_surfaces
             SET screenshot_artifact_path = NULL, screenshot_data_url = NULL
             WHERE id = ?`
          ).run(row.id);
          if (
            row.screenshot_artifact_path &&
            isManagedEvidenceArtifactPath(
              row.screenshot_artifact_path,
              row.id
            )
          ) {
            artifactsToDelete.push({
              surface_id: row.id,
              artifact_path: row.screenshot_artifact_path
            });
          }
          purged += 1;
          continue;
        }

        if (row.screenshot_data_url) {
          const artifactPath = persistEvidenceScreenshot(
            projectPath,
            row.id,
            row.screenshot_data_url
          );
          if (!existsSync(path.resolve(projectPath, artifactPath))) {
            throw new Error(`Failed to materialize evidence media ${row.id}`);
          }
          createdArtifacts.push({
            surface_id: row.id,
            artifact_path: artifactPath
          });
          db.prepare(
            `UPDATE figma_evidence_surfaces
             SET screenshot_artifact_path = ?, screenshot_data_url = NULL
             WHERE id = ?`
          ).run(artifactPath, row.id);
          materialized += 1;
        }
      }
      enqueueEvidenceArtifactDeletions(projectPath, artifactsToDelete);
    });
  } catch (error) {
    for (const artifact of createdArtifacts) {
      discardManagedEvidenceArtifact(
        projectPath,
        artifact.artifact_path,
        artifact.surface_id
      );
    }
    throw error;
  }

  retryNeeded =
    processPendingEvidenceArtifactDeletions(projectPath) || retryNeeded;
  if (bootstrapped) writeRetentionMarker(projectPath);

  let vacuumed = false;
  const needsVacuum =
    vacuumPending && (!bootstrapped || materialized > 0 || purged > 0);
  if (needsVacuum) {
    const db = openProjectDb(projectPath);
    try {
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        db.exec("VACUUM");
        vacuumed = true;
      } catch {
        // Media references are already compact. A busy/disk-limited VACUUM
        // must not make Workbench unreadable; it is a one-time size reclaim,
        // not part of the canonical retention transaction.
      }
    } finally {
      closeProjectDb(db);
    }
  }

  if (vacuumPending && (!needsVacuum || vacuumed)) {
    writeMarker(projectPath, vacuumMarkerPath);
  }
  const retryAt =
    retryNeeded || (vacuumPending && needsVacuum && !vacuumed)
      ? Date.now() + RETRY_DELAY_MS
      : null;
  const scheduledAt =
    retryAt === null
      ? nextExpiryMs
      : nextExpiryMs === null
        ? retryAt
        : Math.min(retryAt, nextExpiryMs);
  scheduleEvidenceMediaMaintenance(projectPath, scheduledAt);

  return { bootstrapped, materialized, purged, vacuumed };
}
