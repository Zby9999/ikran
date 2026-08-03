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
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { closeProjectDb, openProjectDb, withProjectTransaction } from "./db";
import { getArtifactsDir, getIkranDir } from "./paths";

export const EVIDENCE_MEDIA_RETENTION_MS = 24 * 60 * 60 * 1_000;

const MANAGED_MEDIA_DIR_NAME = "evidence-media";
const RETENTION_MARKER_NAME = "evidence-media-retention-v1.json";
const DATA_URL_RE =
  /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/]+=*)$/i;

type SurfaceMediaRow = {
  id: string;
  screenshot_artifact_path: string | null;
  screenshot_data_url: string | null;
  superseded_by: string | null;
  superseded_at: string | null;
};

export type EvidenceMediaMaintenanceResult = {
  bootstrapped: boolean;
  materialized: number;
  purged: number;
  vacuumed: boolean;
};

export function getEvidenceMediaMarkerPath(projectPath: string): string {
  return path.join(getIkranDir(projectPath), RETENTION_MARKER_NAME);
}

function getManagedMediaDir(projectPath: string): string {
  return path.join(getArtifactsDir(projectPath), MANAGED_MEDIA_DIR_NAME);
}

function managedRelativePath(surfaceId: string, extension: string): string {
  return path.posix.join(
    ".ikran",
    "artifacts",
    MANAGED_MEDIA_DIR_NAME,
    `${surfaceId}.${extension}`
  );
}

export function isManagedEvidenceArtifactPath(artifactPath: string): boolean {
  const normalized = artifactPath.replaceAll("\\", "/");
  return normalized.startsWith(
    `.ikran/artifacts/${MANAGED_MEDIA_DIR_NAME}/`
  );
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

  const relativePath = managedRelativePath(surfaceId, decoded.extension);
  const absolutePath = path.join(projectPath, ...relativePath.split("/"));
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
  artifactPath: string | null
): void {
  if (!artifactPath || !isManagedEvidenceArtifactPath(artifactPath)) return;
  const absolutePath = path.resolve(projectPath, artifactPath);
  const mediaRoot = path.resolve(getManagedMediaDir(projectPath));
  if (!absolutePath.startsWith(`${mediaRoot}${path.sep}`)) return;
  rmSync(absolutePath, { force: true });
}

function writeRetentionMarker(projectPath: string): void {
  const markerPath = getEvidenceMediaMarkerPath(projectPath);
  mkdirSync(path.dirname(markerPath), { recursive: true });
  const tempPath = `${markerPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(
      tempPath,
      `${JSON.stringify({ version: 1, initialized_at: new Date().toISOString() })}\n`,
      { flag: "wx", mode: 0o600 }
    );
    renameSync(tempPath, markerPath);
  } finally {
    rmSync(tempPath, { force: true });
  }
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
  const cutoff = new Date(
    (options.now ?? new Date()).getTime() - EVIDENCE_MEDIA_RETENTION_MS
  ).toISOString();
  const createdArtifacts: string[] = [];
  const artifactsToDelete: string[] = [];

  let materialized = 0;
  let purged = 0;
  try {
    withProjectTransaction(projectPath, (db) => {
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

        if (expired) {
          db.prepare(
            `UPDATE figma_evidence_surfaces
             SET screenshot_artifact_path = NULL, screenshot_data_url = NULL
             WHERE id = ?`
          ).run(row.id);
          if (row.screenshot_artifact_path) {
            artifactsToDelete.push(row.screenshot_artifact_path);
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
          createdArtifacts.push(artifactPath);
          db.prepare(
            `UPDATE figma_evidence_surfaces
             SET screenshot_artifact_path = ?, screenshot_data_url = NULL
             WHERE id = ?`
          ).run(artifactPath, row.id);
          materialized += 1;
        }
      }
    });
  } catch (error) {
    for (const artifactPath of createdArtifacts) {
      removeManagedEvidenceArtifact(projectPath, artifactPath);
    }
    throw error;
  }

  for (const artifactPath of artifactsToDelete) {
    removeManagedEvidenceArtifact(projectPath, artifactPath);
  }

  let vacuumed = false;
  if (bootstrapped && (materialized > 0 || purged > 0)) {
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

  if (bootstrapped) writeRetentionMarker(projectPath);

  return { bootstrapped, materialized, purged, vacuumed };
}
