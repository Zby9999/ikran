// Code-backed capture generation for component spec heroes (Issue 32).
//
// Issue 31 wrote the Prototype's real code paths back into spec
// `value.codeLinks`; this module turns them into the visible upgrade: the
// Agent explicitly triggers a capture for one component spec entry, Runtime
// screenshots the component's CURRENT code rendering (a prototype surface's
// preview URL, via the same headless-Chromium path as
// capture_rule_screenshot), and writes the capture back into the entry's
// sourceCaptures with `origin: "code"` plus the content digest of the code
// files it froze. The Design System Browser hero reads that as the
// code-backed tier; the view marks the capture stale once the code changes.
//
// Gating is fail-closed and honest: the entry must be a component spec with
// non-empty codeLinks whose files all resolve inside the project; a failed
// render (no preview, no browser, navigation error) returns a typed reason
// and writes NOTHING — the existing captures stay untouched, so the hero
// falls back to source-capture / unavailable instead of going blank.
//
// The write-back reuses the formalize/backfill Phase-2 pattern: schema
// validation + canonical serialization + original bytes restored on any
// failure, and the row update + the event commit in one transaction. A
// formalized entry gets fresh approval-grade provenance for its new content
// digest, same rationale as backfillComponentCodeLinks.
//
// Re-triggering replaces the entry's previous code capture (the hero shows
// the latest render); source captures are never touched. No batching — one
// entry per call, explicitly declared.
//
// Issue 33: the call may additionally declare a `harnessPath` — a same-origin
// relative route the Agent added to the prototype app that mounts the
// component standalone and honors `?state=<name>`. The path is validated
// (leading slash; no traversal, scheme/authority, query or fragment) and
// written onto the code capture record; the Design System Browser upgrades
// the hero from this static capture to a live sandboxed iframe render.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  closeProjectDb,
  openProjectDb,
  withProjectTransaction
} from "./db";
import {
  buildLoggedEvent,
  insertEvent,
  logEventOnDb,
  logInvalidToolEvent
} from "./events";
import { emitRecordEvent } from "./record-bus";
import { locateEntryObject } from "./design-system-approval";
import { designSystemEntryContentDigest } from "./design-system-entry-provenance";
import { codeCaptureDigest } from "./code-capture-digest";
import {
  mergeEntrySourceCaptures,
  stripSourceCaptures
} from "./design-system-ingest";
import {
  isCaptureHarnessPath,
  validateDesignSystemJson
} from "./design-system-schema";
import { recordDesignSystemDigestIfConsistent } from "./design-system-sync";
import {
  stableJsonStringify,
  writeDesignSystemViewExport
} from "./design-system-view";
import { resolveProjectArtifactPath } from "./evidence-package";
import {
  captureRuleScreenshot,
  type CaptureRuleScreenshotInput,
  type CaptureRuleScreenshotResult,
  type RuleCaptureRect
} from "./rule-capture";

export interface CaptureComponentCodeHeroInput {
  /** design_system_entries row id or entry_id of a component spec entry. */
  entryId: string;
  /** Prototype Evidence Surface whose preview renders the component's code. */
  surfaceId: string;
  /** Output file name under design-system/captures/ (basename only). */
  fileName?: string;
  /** Normalized crop against the full page; absent captures everything. */
  crop?: RuleCaptureRect;
  /** Live-render harness route the Agent added to the prototype app (Issue
   * 33): a same-origin relative path mounting the component standalone and
   * honoring `?state=<name>`. Declared paths are written onto the capture
   * record and upgrade the Browser hero from this static capture to a live
   * sandboxed iframe; absent, the hero stays the Issue-32 static render. */
  harnessPath?: string;
}

/** Failure reasons the screenshot seam may report — the
 * captureRuleScreenshot contract narrowed to the closed set it actually
 * returns; anything unexpected maps to "capture_failed" at the seam (never
 * a cast), so callers get compile-time coverage. */
export type CodeCaptureScreenshotFailureReason =
  | "surface_not_found"
  | "preview_unavailable"
  | "browser_unavailable"
  | "capture_failed"
  | "write_failed";

export type CodeCaptureScreenshotResult =
  | { ok: true; artifactPath: string }
  | { ok: false; reason: CodeCaptureScreenshotFailureReason };

function toScreenshotFailureReason(
  reason: string
): CodeCaptureScreenshotFailureReason {
  switch (reason) {
    case "surface_not_found":
    case "preview_unavailable":
    case "browser_unavailable":
    case "write_failed":
      return reason;
    default:
      return "capture_failed";
  }
}

export interface CodeCaptureDeps {
  /** Screenshot the surface preview; defaults to captureRuleScreenshot. */
  capture(
    projectPath: string,
    input: CaptureRuleScreenshotInput
  ): Promise<CodeCaptureScreenshotResult>;
  /** ISO timestamp stamped onto the capture record. */
  now(): string;
}

const defaultCodeCaptureDeps: CodeCaptureDeps = {
  capture: async (projectPath, input) => {
    const result: CaptureRuleScreenshotResult = await captureRuleScreenshot(
      projectPath,
      input
    );
    if (result.ok) return { ok: true, artifactPath: result.artifactPath };
    return { ok: false, reason: toScreenshotFailureReason(result.reason) };
  },
  now: () => new Date().toISOString()
};

export type CaptureComponentCodeHeroFailure = {
  ok: false;
  reason:
    | "invalid_input"
    | "entry_not_found"
    | "entry_not_component_spec"
    | "no_code_links"
    | "code_file_missing"
    | "surface_not_found"
    | "preview_unavailable"
    | "browser_unavailable"
    | "capture_failed"
    | "write_failed"
    | "artifact_path_escape"
    | "artifact_file_missing"
    | "invalid_design_system_json"
    | "entry_not_in_source_file"
    | "db_error";
  details?: unknown;
};

export type CaptureComponentCodeHeroResult =
  | {
      ok: true;
      entry_id: string;
      source_artifact_path: string;
      artifact_path: string;
      surface_id: string;
      code_links: string[];
      code_digest: string;
      /** Declared live-render harness route (Issue 33), null when omitted. */
      harness_path: string | null;
      event_id: string;
    }
  | CaptureComponentCodeHeroFailure;

type EntryRow = {
  id: string;
  entry_id: string;
  name: string | null;
  source_artifact_path: string;
  file_kind: string;
  status: string;
  value_json: string;
  source_captures_json: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Basename for the default capture file; entry ids may contain dots. */
function defaultFileName(entryId: string): string {
  const safe = entryId.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `code-capture-${safe}-${Date.now()}.png`;
}

export async function captureComponentCodeHero(
  projectPath: string,
  input: CaptureComponentCodeHeroInput,
  deps: CodeCaptureDeps = defaultCodeCaptureDeps
): Promise<CaptureComponentCodeHeroResult> {
  const entryId = typeof input.entryId === "string" ? input.entryId.trim() : "";
  const surfaceId =
    typeof input.surfaceId === "string" ? input.surfaceId.trim() : "";
  if (entryId.length === 0 || surfaceId.length === 0) {
    return { ok: false, reason: "invalid_input" };
  }
  // Harness declaration (Issue 33): a same-origin relative path only — the
  // hero iframe builds `<previewUrl><harnessPath>?state=<name>` from it, so
  // anything that could navigate away from the surface origin fails closed.
  const harnessPath =
    typeof input.harnessPath === "string" ? input.harnessPath.trim() : "";
  if (
    input.harnessPath !== undefined &&
    (harnessPath.length === 0 || !isCaptureHarnessPath(harnessPath))
  ) {
    return {
      ok: false,
      reason: "invalid_input",
      details: { harnessPath: input.harnessPath }
    };
  }

  // -- Phase 1 (read-only): entry lookup + codeLinks gate. Only a component
  //    spec whose real code was backfilled (Issue 31) may claim a
  //    code-backed capture; every linked file must resolve inside the
  //    project so the frozen digest is verifiable.
  let row: EntryRow;
  let codeLinks: string[];
  let codeDigest: string;
  {
    let db;
    try {
      db = openProjectDb(projectPath);
    } catch {
      return { ok: false, reason: "db_error" };
    }
    try {
      const found = db
        .prepare(
          `SELECT id, entry_id, name, source_artifact_path, file_kind, status,
                  value_json, source_captures_json
           FROM design_system_entries WHERE id = ? OR entry_id = ?`
        )
        .get(entryId, entryId) as EntryRow | undefined;
      if (!found) {
        return { ok: false, reason: "entry_not_found", details: { entryId } };
      }
      if (found.file_kind !== "component-spec") {
        return {
          ok: false,
          reason: "entry_not_component_spec",
          details: { entryId: found.entry_id, file_kind: found.file_kind }
        };
      }
      row = found;
    } catch {
      return { ok: false, reason: "db_error" };
    } finally {
      closeProjectDb(db);
    }
  }
  {
    let value: unknown;
    try {
      value = JSON.parse(row.value_json) as unknown;
    } catch {
      return { ok: false, reason: "invalid_design_system_json" };
    }
    const rawLinks = isPlainObject(value) ? value.codeLinks : undefined;
    codeLinks = Array.isArray(rawLinks)
      ? [
          ...new Set(
            rawLinks
              .filter((link): link is string => typeof link === "string")
              .map((link) => link.trim())
              .filter((link) => link.length > 0)
          )
        ]
      : [];
    if (codeLinks.length === 0) {
      return {
        ok: false,
        reason: "no_code_links",
        details: { entryId: row.entry_id }
      };
    }
    const digest = codeCaptureDigest(projectPath, codeLinks);
    if (digest === null) {
      return {
        ok: false,
        reason: "code_file_missing",
        details: { entryId: row.entry_id, codeLinks }
      };
    }
    codeDigest = digest;
  }

  // -- Phase 2: screenshot the code rendering BEFORE anything is written.
  //    A failed render is the honest fallback: no file, no DB write, the
  //    entry keeps its current captures.
  const capture = await deps.capture(projectPath, {
    surfaceId,
    fileName: input.fileName ?? defaultFileName(row.entry_id),
    ...(input.crop === undefined ? {} : { crop: input.crop })
  });
  if (!capture.ok) {
    return {
      ok: false,
      reason: capture.reason,
      details: { entryId: row.entry_id, surfaceId }
    };
  }

  const captureRecord = {
    nodeName: row.name ?? row.entry_id,
    artifactPath: capture.artifactPath,
    capturedAt: deps.now(),
    surfaceId,
    origin: "code",
    codeLinks,
    codeDigest,
    ...(harnessPath.length > 0 ? { harnessPath } : {})
  };

  // -- Phase 3: write the capture into the source spec file. Original bytes
  //    stay in memory for the restore path; a file the Runtime cannot
  //    rewrite fails the whole capture before any DB write.
  const sourcePath = row.source_artifact_path;
  const absolutePath = resolveProjectArtifactPath(projectPath, sourcePath);
  if (absolutePath === null) {
    return { ok: false, reason: "artifact_path_escape" };
  }
  let originalContent: string;
  try {
    originalContent = readFileSync(absolutePath, "utf-8");
  } catch {
    return { ok: false, reason: "artifact_file_missing" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(originalContent) as unknown;
  } catch {
    return { ok: false, reason: "invalid_design_system_json" };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, reason: "invalid_design_system_json" };
  }
  const restoreWrittenFile = () => {
    try {
      writeFileSync(absolutePath, originalContent, "utf-8");
    } catch {
      // Best-effort restore; the reported failure reason stands.
    }
  };
  const entryObject = locateEntryObject("component-spec", parsed, row.entry_id);
  if (entryObject === null) {
    return {
      ok: false,
      reason: "entry_not_in_source_file",
      details: { source_artifact_path: sourcePath, entry_id: row.entry_id }
    };
  }
  if (!isPlainObject(entryObject.value)) {
    return { ok: false, reason: "invalid_design_system_json" };
  }
  // The new render supersedes earlier code captures; source captures stay.
  const existingCaptures = mergeEntrySourceCaptures(
    entryObject.sourceCaptures,
    entryObject.value.sourceCaptures
  );
  const keptCaptures = existingCaptures.filter(
    (item) => !(isPlainObject(item) && item.origin === "code")
  );
  const nextCaptures = [...keptCaptures, captureRecord];
  const nextValue = { ...entryObject.value, sourceCaptures: nextCaptures };
  entryObject.value = nextValue;
  // Canonicalize legacy component specs while this Runtime-owned write-back
  // already has the file open: component captures live in value only.
  delete entryObject.sourceCaptures;
  const dbValue = JSON.stringify(stripSourceCaptures(nextValue));
  const dbCaptures = JSON.stringify(nextCaptures);
  // A formalized entry whose content changes needs fresh approval-grade
  // provenance for the re-ingest status gate (same as backfill).
  const approvedDigest =
    row.status === "formalized"
      ? designSystemEntryContentDigest(entryObject)
      : null;

  const validation = validateDesignSystemJson("component-spec", parsed);
  if (!validation.ok) {
    return {
      ok: false,
      reason: "invalid_design_system_json",
      details: { reason: validation.reason, details: validation.details }
    };
  }
  const newContent = `${stableJsonStringify(parsed)}\n`;
  try {
    writeFileSync(absolutePath, newContent, "utf-8");
  } catch {
    return { ok: false, reason: "write_failed" };
  }

  // -- Phase 4: transaction (row value + captures update and the event in
  //    one commit), re-checking the entry still exists so a concurrent
  //    delete fails without keeping the file write.
  try {
    const transaction = withProjectTransaction(projectPath, (db) => {
      const current = db
        .prepare(`SELECT status FROM design_system_entries WHERE id = ?`)
        .get(row.id) as { status: string } | undefined;
      if (current === undefined) {
        return {
          ok: false as const,
          reason: "entry_not_found" as const,
          details: { entryId: row.entry_id }
        };
      }
      db.prepare(
        `UPDATE design_system_entries
         SET value_json = ?, source_captures_json = ?, updated_at = ?
         WHERE id = ?`
      ).run(dbValue, dbCaptures, new Date().toISOString(), row.id);
      const event = buildLoggedEvent("design_system_code_capture_recorded", {
        command: "capture_component_code_hero",
        entry_id: row.entry_id,
        source_artifact_path: sourcePath,
        artifact_path: capture.artifactPath,
        surface_id: surfaceId,
        code_links: codeLinks,
        code_digest: codeDigest,
        ...(harnessPath.length > 0 ? { harness_path: harnessPath } : {})
      });
      insertEvent(db, event);
      if (approvedDigest !== null) {
        logEventOnDb(db, "design_system_entry_approved", {
          source_artifact_path: sourcePath,
          entry_id: row.entry_id,
          content_digest: approvedDigest,
          from: "formalized",
          to: "formalized",
          via: "capture_component_code_hero"
        });
      }
      return { ok: true as const, event };
    });
    if (!transaction.ok) {
      restoreWrittenFile();
      return transaction;
    }

    // -- Phase 5 (post-commit): digest ledger (only when the written file
    //    matches the DB row), invalidation, derived export.
    recordDesignSystemDigestIfConsistent(
      projectPath,
      "component-spec",
      parsed,
      sourcePath,
      newContent
    );
    emitRecordEvent({
      kind: "design-system",
      action: "updated",
      id: sourcePath,
      projectPath: path.resolve(projectPath)
    });
    const exportResult = writeDesignSystemViewExport(projectPath);
    if (!exportResult.ok) {
      logInvalidToolEvent(
        projectPath,
        "invalid_output",
        "design_system_view_export",
        exportResult.reason
      );
    }
    return {
      ok: true,
      entry_id: row.entry_id,
      source_artifact_path: sourcePath,
      artifact_path: capture.artifactPath,
      surface_id: surfaceId,
      code_links: codeLinks,
      code_digest: codeDigest,
      harness_path: harnessPath.length > 0 ? harnessPath : null,
      event_id: transaction.event.event_id
    };
  } catch {
    restoreWrittenFile();
    return { ok: false, reason: "db_error" };
  }
}
