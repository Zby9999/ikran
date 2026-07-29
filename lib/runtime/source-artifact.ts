// Source artifact declaration + artifact index (Issue 08).
//
// The Agent writes source artifacts (design-system JSON sources, prototype /
// code) via its host's native file editing (ADR 0004), then MUST declare each
// one via `record_artifact_written`. Runtime only acknowledges declared +
// validated artifacts: a valid declaration records a `source_artifact_declared`
// event and upserts the artifact-index row.
//
// Three validation classes, all deterministic:
//   1. semantic record schema — structural check on the declaration itself.
//   2. design-system artifact — deep per-file JSON schemas (Issue 09 /
//      09A, Task B) plugged into the per-type `checkFile` seam below, plus a
//      declaration-time link requirement: related_record_ids must reference
//      answered alignment question cards (design-system-status.ts).
//   3. prototype/code artifact — file exists, in project scope, optional
//      Agent-declared readiness. Runtime never judges code quality and never
//      fabricates semantics.
//
// On failure: `invalid_artifact` event + structured error, NO index row —
// mirroring the invalid-output convention in evidence-package.ts.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { openProjectDb, closeProjectDb, withProjectTransaction } from "./db";
import { emitRecordEvent } from "./record-bus";
import { logEventOnDb, logInvalidToolEvent } from "./events";
import {
  assertArtifactPathInProject,
  resolveProjectArtifactPath
} from "./evidence-package";
import {
  designSystemFileCheck,
  readJsonFileObject,
  type DesignSystemSchemaReason
} from "./design-system-schema";
import {
  checkDesignSystemDeclarationLinksOnDb,
  type DesignSystemDeclarationLinkReason
} from "./design-system-status";

// ---------------------------------------------------------------------------
// Artifact type registry (data-driven; add new types as entries below)
// ---------------------------------------------------------------------------

export type SourceArtifactClass = "design-system" | "code";

export type SourceArtifactFileCheckReason =
  | "artifact_file_missing"
  | "invalid_design_system_json"
  | DesignSystemSchemaReason
  | string;

/**
 * Deterministic structural file check. Returns a reason on failure, null when
 * the file passes. Must never judge content quality or semantics.
 */
export type SourceArtifactFileCheck = (
  absolutePath: string
) => SourceArtifactFileCheckReason | null;

export interface SourceArtifactTypeSpec {
  /** Validation class: design-system JSON source vs prototype/code file. */
  validationClass: SourceArtifactClass;
  /**
   * Per-type file check seam. When absent, the class default applies. Task B
   * (Issue 09) plugs deep per-file design-system schemas in here without
   * touching the declaration path.
   */
  checkFile?: SourceArtifactFileCheck;
}

/** Known source artifact types: 09A design-system files + prototype/code. */
export const SOURCE_ARTIFACT_TYPE_REGISTRY: Readonly<
  Record<string, SourceArtifactTypeSpec>
> = {
  "design-system.json": {
    validationClass: "design-system",
    checkFile: designSystemFileCheck("design-system.json")
  },
  "token.json": {
    validationClass: "design-system",
    checkFile: designSystemFileCheck("token.json")
  },
  "component-list.json": {
    validationClass: "design-system",
    checkFile: designSystemFileCheck("component-list.json")
  },
  "component-spec": {
    validationClass: "design-system",
    checkFile: designSystemFileCheck("component-spec")
  },
  "layout-rules.json": {
    validationClass: "design-system",
    checkFile: designSystemFileCheck("layout-rules.json")
  },
  "interaction-rules.json": {
    validationClass: "design-system",
    checkFile: designSystemFileCheck("interaction-rules.json")
  },
  prototype: { validationClass: "code" },
  code: { validationClass: "code" }
};

/**
 * Class 2 fallback: file shell only (exists, parses, top-level object). All
 * registered design-system types override this via `checkFile` (Task B deep
 * schemas); the fallback only covers future types added without one.
 */
const designSystemJsonFileCheck: SourceArtifactFileCheck = (absolutePath) => {
  const file = readJsonFileObject(absolutePath);
  return file.ok ? null : file.reason;
};

/** Class 3 default: existence only — never a quality judgment. */
const codeFileCheck: SourceArtifactFileCheck = (absolutePath) =>
  existsSync(absolutePath) ? null : "artifact_file_missing";

const CLASS_FILE_CHECKS: Record<SourceArtifactClass, SourceArtifactFileCheck> =
  {
    "design-system": designSystemJsonFileCheck,
    code: codeFileCheck
  };

// ---------------------------------------------------------------------------
// Class 1: declaration schema validation (transport-independent)
// ---------------------------------------------------------------------------

export interface NormalizedSourceArtifactDeclaration {
  path: string;
  artifactType: string;
  semanticPurpose: string;
  relatedRecordIds: string[];
  readiness?: string;
}

export type SourceArtifactDeclarationReason =
  | "missing_path"
  | "missing_artifact_type"
  | "unknown_artifact_type"
  | "missing_semantic_purpose"
  | "invalid_related_record_ids";

export type SourceArtifactDeclarationOk = {
  ok: true;
  declaration: NormalizedSourceArtifactDeclaration;
};

export type SourceArtifactDeclarationError = {
  ok: false;
  reason: SourceArtifactDeclarationReason | string;
  details?: unknown;
};

export type SourceArtifactDeclarationResult =
  | SourceArtifactDeclarationOk
  | SourceArtifactDeclarationError;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function fail(
  reason: SourceArtifactDeclarationReason | string,
  details?: unknown
): SourceArtifactDeclarationError {
  return details === undefined
    ? { ok: false, reason }
    : { ok: false, reason, details };
}

export function validateSourceArtifactDeclaration(
  input: unknown
): SourceArtifactDeclarationResult {
  if (input === null || typeof input !== "object") {
    return fail("missing_path", { message: "input must be an object" });
  }
  const raw = input as Record<string, unknown>;

  if (!isNonEmptyString(raw.path)) {
    return fail("missing_path");
  }
  if (!isNonEmptyString(raw.artifactType)) {
    return fail("missing_artifact_type");
  }
  if (
    !Object.prototype.hasOwnProperty.call(
      SOURCE_ARTIFACT_TYPE_REGISTRY,
      raw.artifactType
    )
  ) {
    return fail("unknown_artifact_type", {
      knownTypes: Object.keys(SOURCE_ARTIFACT_TYPE_REGISTRY)
    });
  }
  if (!isNonEmptyString(raw.semanticPurpose)) {
    return fail("missing_semantic_purpose");
  }

  let relatedRecordIds: string[] = [];
  if (raw.relatedRecordIds !== undefined) {
    if (!Array.isArray(raw.relatedRecordIds)) {
      return fail("invalid_related_record_ids");
    }
    for (let i = 0; i < raw.relatedRecordIds.length; i++) {
      if (!isNonEmptyString(raw.relatedRecordIds[i])) {
        return fail("invalid_related_record_ids", { index: i });
      }
    }
    relatedRecordIds = raw.relatedRecordIds;
  }

  const declaration: NormalizedSourceArtifactDeclaration = {
    path: raw.path,
    artifactType: raw.artifactType,
    semanticPurpose: raw.semanticPurpose,
    relatedRecordIds
  };
  if (isNonEmptyString(raw.readiness)) {
    declaration.readiness = raw.readiness;
  }
  return { ok: true, declaration };
}

// ---------------------------------------------------------------------------
// Persist: recordSourceArtifact + artifact index queries
// ---------------------------------------------------------------------------

export interface SourceArtifactRecord {
  id: string;
  /** Canonical project-relative path (artifact index identity). */
  path: string;
  artifact_type: string;
  semantic_purpose: string;
  related_record_ids_json: string;
  readiness: string | null;
  declaration_version: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export type SourceArtifactRecordReason =
  | SourceArtifactDeclarationReason
  | SourceArtifactFileCheckReason
  | DesignSystemDeclarationLinkReason
  | "artifact_path_escape"
  | "db_error"
  | string;

export interface SourceArtifactRecordResult {
  ok: true;
  record: SourceArtifactRecord;
  /** Canonical audit event id (always a string on success). */
  event_id: string;
}

export interface SourceArtifactRecordError {
  ok: false;
  reason: SourceArtifactRecordReason;
}

export type SourceArtifactRecordResponse =
  | SourceArtifactRecordResult
  | SourceArtifactRecordError;

/**
 * Declared path from raw input, when present — included in the
 * `invalid_artifact` event payload so failed declarations stay traceable.
 */
function rawDeclaredPath(input: unknown): string | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>).path;
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function logInvalidArtifact(
  projectPath: string,
  reason: string,
  declaredPath?: string,
  details?: unknown
): void {
  let mergedDetails = details;
  if (declaredPath !== undefined) {
    mergedDetails =
      details !== null && typeof details === "object" && !Array.isArray(details)
        ? { path: declaredPath, ...(details as Record<string, unknown>) }
        : { path: declaredPath };
  }
  logInvalidToolEvent(
    projectPath,
    "invalid_artifact",
    "record_artifact_written",
    reason,
    mergedDetails
  );
}

/**
 * Canonical project-relative form of an artifact path (accepts absolute or
 * project-relative input); null when empty or out of project scope.
 */
export function canonicalizeArtifactPath(
  projectPath: string,
  artifactPath: string
): string | null {
  if (typeof artifactPath !== "string" || artifactPath.trim().length === 0) {
    return null;
  }
  if (assertArtifactPathInProject(projectPath, artifactPath) !== null) {
    return null;
  }
  const projectRoot = path.resolve(projectPath);
  return path.relative(projectRoot, path.resolve(projectRoot, artifactPath));
}

export function recordSourceArtifact(
  projectPath: string,
  input: unknown
): SourceArtifactRecordResponse {
  const validated = validateSourceArtifactDeclaration(input);
  if (!validated.ok) {
    logInvalidArtifact(
      projectPath,
      validated.reason,
      rawDeclaredPath(input),
      validated.details
    );
    return { ok: false, reason: validated.reason };
  }
  const declaration = validated.declaration;

  // Project-scope check (lexical + realpath, fail-closed) before any I/O.
  if (assertArtifactPathInProject(projectPath, declaration.path) !== null) {
    logInvalidArtifact(
      projectPath,
      "artifact_path_escape",
      declaration.path
    );
    return { ok: false, reason: "artifact_path_escape" };
  }
  const relativePath = canonicalizeArtifactPath(projectPath, declaration.path)!;
  const absolutePath = resolveProjectArtifactPath(
    projectPath,
    declaration.path
  )!;

  // Class 2 / 3 deterministic file check.
  const spec = SOURCE_ARTIFACT_TYPE_REGISTRY[declaration.artifactType]!;
  const checkFile = spec.checkFile ?? CLASS_FILE_CHECKS[spec.validationClass];
  const fileFailure = checkFile(absolutePath);
  if (fileFailure !== null) {
    logInvalidArtifact(projectPath, fileFailure, relativePath);
    return { ok: false, reason: fileFailure };
  }

  const now = new Date().toISOString();

  try {
    const result = withProjectTransaction(projectPath, (db) => {
      // Design-system declarations must link answered question cards or
      // Agent annotations (09A decision 4); the DB-dependent check runs
      // inside the transaction so it shares a snapshot with the write.
      if (spec.validationClass === "design-system") {
        const linkCheck = checkDesignSystemDeclarationLinksOnDb(
          db,
          declaration.relatedRecordIds
        );
        if (!linkCheck.ok) return linkCheck;
      }

      const existing = db
        .prepare(
          `SELECT id, declaration_version, created_at
           FROM source_artifacts WHERE path = ?`
        )
        .get(relativePath) as
        | { id: string; declaration_version: number; created_at: string }
        | undefined;

      // Re-declaring the same path updates the index row with a new
      // declaration version instead of duplicating it.
      const record: SourceArtifactRecord = {
        id: existing?.id ?? randomUUID(),
        path: relativePath,
        artifact_type: declaration.artifactType,
        semantic_purpose: declaration.semanticPurpose,
        related_record_ids_json: JSON.stringify(declaration.relatedRecordIds),
        readiness: declaration.readiness ?? null,
        declaration_version: (existing?.declaration_version ?? 0) + 1,
        status: "declared",
        created_at: existing?.created_at ?? now,
        updated_at: now
      };

      if (existing) {
        db.prepare(
          `UPDATE source_artifacts
           SET artifact_type = ?, semantic_purpose = ?,
               related_record_ids_json = ?, readiness = ?,
               declaration_version = ?, status = ?, updated_at = ?
           WHERE id = ?`
        ).run(
          record.artifact_type,
          record.semantic_purpose,
          record.related_record_ids_json,
          record.readiness,
          record.declaration_version,
          record.status,
          record.updated_at,
          record.id
        );
      } else {
        db.prepare(
          `INSERT INTO source_artifacts (
            id, path, artifact_type, semantic_purpose,
            related_record_ids_json, readiness, declaration_version,
            status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          record.id,
          record.path,
          record.artifact_type,
          record.semantic_purpose,
          record.related_record_ids_json,
          record.readiness,
          record.declaration_version,
          record.status,
          record.created_at,
          record.updated_at
        );
      }

      const event = logEventOnDb(db, "source_artifact_declared", {
        artifact_id: record.id,
        path: record.path,
        artifact_type: record.artifact_type,
        semantic_purpose: record.semantic_purpose,
        related_record_ids: declaration.relatedRecordIds,
        declaration_version: record.declaration_version
      });

      return {
        ok: true as const,
        record,
        event_id: event.event_id,
        action: existing ? ("updated" as const) : ("created" as const)
      };
    });

    if (!result.ok) {
      logInvalidArtifact(projectPath, result.reason, relativePath, result.details);
      return { ok: false, reason: result.reason };
    }

    emitRecordEvent({
      kind: "artifact",
      action: result.action,
      id: result.record.id,
      projectPath: path.resolve(projectPath)
    });

    return {
      ok: true,
      record: result.record,
      event_id: result.event_id
    };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

// ---------------------------------------------------------------------------
// Artifact index queries — undeclared-file guard for future research export
// (Issue 15 builds the export itself on top of these).
// ---------------------------------------------------------------------------

export function listDeclaredArtifacts(
  projectPath: string
): SourceArtifactRecord[] {
  const db = openProjectDb(projectPath);
  try {
    return db
      .prepare("SELECT * FROM source_artifacts ORDER BY created_at ASC")
      .all() as unknown as SourceArtifactRecord[];
  } finally {
    closeProjectDb(db);
  }
}

/**
 * Undeclared-file guard: a file counts only when its canonical
 * project-relative path is in the artifact index. Out-of-scope paths fail
 * closed as undeclared.
 */
export function isDeclaredArtifact(
  projectPath: string,
  artifactPath: string
): boolean {
  const relative = canonicalizeArtifactPath(projectPath, artifactPath);
  if (relative === null) return false;
  const db = openProjectDb(projectPath);
  try {
    const row = db
      .prepare("SELECT 1 AS ok FROM source_artifacts WHERE path = ?")
      .get(relative);
    return row !== undefined;
  } finally {
    closeProjectDb(db);
  }
}
