import { createHash, randomUUID } from "node:crypto";

import { closeProjectDb, openProjectDb, withProjectTransaction } from "./db";
import { buildLoggedEvent, insertEvent } from "./events";

export const COMPONENT_PREVIEW_DISPOSITIONS = [
  "no_reusable_impact",
  "update_existing_rule",
  "create_candidate",
  "retain_open_gap",
  "unresolved_conflict"
] as const;

export type ComponentPreviewDisposition =
  (typeof COMPONENT_PREVIEW_DISPOSITIONS)[number];

export interface ComponentPreviewExceptionPacket {
  exception_id: string;
  exception_digest: string;
  kind:
    | "provider_recipe"
    | "semantic_delta"
    | "missing_evidence"
    | "legacy_mapping"
    | "conflict";
  identity: {
    run_id: string;
    entry_id: string;
    module_path: string;
    export_name: string;
  };
  current_identity_digest: string;
  current_component_contract: unknown;
  implementation_delta: Record<string, unknown>;
  verification_delta: Record<string, unknown>;
  evidence_record_ids: string[];
  provenance: { artifact_path: string; surface_id: string };
  detected_conflicts: string[];
  permitted_target_categories: string[];
  unresolved_questions: string[];
}

export interface CreateComponentPreviewExceptionInput {
  runId: string;
  surfaceId: string;
  entryId: string;
  modulePath: string;
  exportName: string;
  providerRecipe?: Record<string, unknown>;
  relatedRecordIds?: readonly string[];
  kind?: ComponentPreviewExceptionPacket["kind"];
  implementationDelta?: Record<string, unknown>;
  detectedConflicts?: readonly string[];
  unresolvedQuestions?: readonly string[];
}

export interface ResolveComponentPreviewExceptionInput {
  exceptionId: string;
  expectedDigest: string;
  disposition: ComponentPreviewDisposition;
  rationale: string;
  evidenceRecordIds: readonly string[];
  targetEntryId?: string;
  targetCategory?: string;
}

export type ResolveComponentPreviewExceptionResult =
  | {
      ok: true;
      exception_id: string;
      disposition: ComponentPreviewDisposition;
      event_id: string;
      next_action: "redeclaration_required" | "existing_rule_update_review" | "await_more_evidence";
    }
  | { ok: false; reason: string; details?: unknown };

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function currentIdentityDigestOnDb(
  db: ReturnType<typeof openProjectDb>,
  identity: ComponentPreviewExceptionPacket["identity"]
): string | null {
  const entry = db.prepare(
    `SELECT value_json FROM design_system_entries WHERE entry_id = ?`
  ).get(identity.entry_id) as { value_json: string } | undefined;
  const artifact = db.prepare(
    `SELECT content_digest, status
     FROM source_artifacts WHERE path = ?`
  ).get(identity.module_path) as
    | { content_digest: string | null; status: string }
    | undefined;
  if (!entry || !artifact) return null;
  return digest({
    identity,
    component_contract: JSON.parse(entry.value_json),
    artifact: {
      content_digest: artifact.content_digest,
      status: artifact.status
    }
  });
}

export function createComponentPreviewException(
  projectPath: string,
  input: CreateComponentPreviewExceptionInput
): ComponentPreviewExceptionPacket {
  const db = openProjectDb(projectPath);
  let entry: { entry_id: string; value_json: string; links_json: string };
  try {
    const row = db.prepare(
      `SELECT entry_id, value_json, links_json FROM design_system_entries
       WHERE id = ? OR entry_id = ? LIMIT 1`
    ).get(input.entryId, input.entryId) as typeof entry | undefined;
    if (!row) throw new Error(`Unknown component entry: ${input.entryId}`);
    entry = row;
  } finally {
    closeProjectDb(db);
  }
  const id = randomUUID();
  const kind: ComponentPreviewExceptionPacket["kind"] =
    input.kind ?? (input.providerRecipe ? "provider_recipe" : "semantic_delta");
  const evidence = [
    ...new Set([
      ...(JSON.parse(entry.links_json) as string[]),
      ...(input.relatedRecordIds ?? [])
    ])
  ].sort();
  const identity = {
    run_id: input.runId,
    entry_id: entry.entry_id,
    module_path: input.modulePath,
    export_name: input.exportName
  };
  const identityDb = openProjectDb(projectPath);
  let currentIdentityDigest: string | null;
  try {
    currentIdentityDigest = currentIdentityDigestOnDb(identityDb, identity);
  } finally {
    closeProjectDb(identityDb);
  }
  if (!currentIdentityDigest) {
    throw new Error("Cannot create component Preview exception without current identity");
  }
  const defaultConflict =
    kind === "provider_recipe"
      ? "provider_recipe_requires_judgment"
      : "semantic_delta_requires_judgment";
  const body = {
    kind,
    identity,
    current_identity_digest: currentIdentityDigest,
    current_component_contract: JSON.parse(entry.value_json) as unknown,
    implementation_delta: input.implementationDelta ?? {
      provider_recipe: input.providerRecipe ?? null
    },
    verification_delta: {
      status: "not_started",
      reason: kind === "provider_recipe" ? "provider_recipe_requires_judgment" : "semantic_delta_requires_judgment"
    },
    evidence_record_ids: evidence,
    provenance: {
      artifact_path: input.modulePath,
      surface_id: input.surfaceId
    },
    detected_conflicts: [...(input.detectedConflicts ?? [defaultConflict])],
    permitted_target_categories: [
      "components.spec",
      "interaction",
      "layout",
      "open_gap"
    ],
    unresolved_questions: [...(input.unresolvedQuestions ?? [
      kind === "provider_recipe"
        ? "Is this provider/fixture reusable design-system infrastructure or a local preview exception?"
        : "Does this implementation change a reusable rule or component contract?"
    ])]
  };
  const exceptionDigest = digest(body);
  const dedupeKey = digest({
    runId: input.runId,
    entryId: entry.entry_id,
    modulePath: input.modulePath,
    kind,
    exceptionDigest
  });
  const existingDb = openProjectDb(projectPath);
  try {
    const existing = existingDb.prepare(
      `SELECT id, packet_json, exception_digest FROM component_preview_exceptions
       WHERE dedupe_key = ?`
    ).get(dedupeKey) as
      | { id: string; packet_json: string; exception_digest: string }
      | undefined;
    if (existing) {
      return {
        ...(JSON.parse(existing.packet_json) as ComponentPreviewExceptionPacket),
        exception_id: existing.id,
        exception_digest: existing.exception_digest
      };
    }
  } finally {
    closeProjectDb(existingDb);
  }
  const packet: ComponentPreviewExceptionPacket = {
    exception_id: id,
    exception_digest: exceptionDigest,
    ...body
  };
  const now = new Date().toISOString();
  withProjectTransaction(projectPath, (writeDb) => {
    writeDb.prepare(
      `INSERT INTO component_preview_exceptions
       (id, dedupe_key, run_id, entry_id, module_path, kind, status,
        packet_json, exception_digest, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    ).run(
      id,
      dedupeKey,
      input.runId,
      entry.entry_id,
      input.modulePath,
      kind,
      JSON.stringify(packet),
      exceptionDigest,
      now,
      now
    );
  });
  return packet;
}

export function resolveComponentPreviewException(
  projectPath: string,
  input: ResolveComponentPreviewExceptionInput
): ResolveComponentPreviewExceptionResult {
  if (!COMPONENT_PREVIEW_DISPOSITIONS.includes(input.disposition)) {
    return { ok: false, reason: "invalid_disposition" };
  }
  if (!input.rationale.trim()) return { ok: false, reason: "missing_rationale" };
  return withProjectTransaction(projectPath, (db) => {
    const row = db.prepare(
      `SELECT status, packet_json, exception_digest, disposition_json,
              disposition_event_id
       FROM component_preview_exceptions WHERE id = ?`
    ).get(input.exceptionId) as
      | {
          status: string;
          packet_json: string;
          exception_digest: string;
          disposition_json: string | null;
          disposition_event_id: string | null;
        }
      | undefined;
    if (!row) return { ok: false as const, reason: "exception_not_found" };
    if (row.exception_digest !== input.expectedDigest) {
      return { ok: false as const, reason: "exception_digest_conflict" };
    }
    if (row.status === "resolved" && row.disposition_json && row.disposition_event_id) {
      const prior = JSON.parse(row.disposition_json) as {
        disposition: ComponentPreviewDisposition;
        next_action: "redeclaration_required" | "existing_rule_update_review" | "await_more_evidence";
      };
      return {
        ok: true as const,
        exception_id: input.exceptionId,
        disposition: prior.disposition,
        event_id: row.disposition_event_id,
        next_action: prior.next_action
      };
    }
    const packet = JSON.parse(row.packet_json) as ComponentPreviewExceptionPacket;
    if (currentIdentityDigestOnDb(db, packet.identity) !== packet.current_identity_digest) {
      return { ok: false as const, reason: "exception_identity_conflict" };
    }
    const evidence = [...new Set(input.evidenceRecordIds)];
    if (evidence.some((id) => !packet.evidence_record_ids.includes(id))) {
      return { ok: false as const, reason: "evidence_not_in_exception" };
    }
    const targetCategory = input.targetCategory?.trim() || null;
    if (targetCategory && !packet.permitted_target_categories.includes(targetCategory)) {
      return { ok: false as const, reason: "target_category_not_permitted" };
    }
    const targetEntryId = input.targetEntryId?.trim() || null;
    if (input.disposition === "update_existing_rule" && !targetEntryId) {
      return { ok: false as const, reason: "target_entry_required" };
    }
    if (targetEntryId) {
      const target = db.prepare(
        `SELECT file_kind, section FROM design_system_entries
         WHERE id = ? OR entry_id = ? LIMIT 1`
      ).get(targetEntryId, targetEntryId) as
        | { file_kind: string; section: string }
        | undefined;
      if (!target) return { ok: false as const, reason: "target_entry_not_found" };
      const ownedCategory =
        target.file_kind === "component-spec" ? "components.spec" : target.section;
      if (!packet.permitted_target_categories.includes(ownedCategory)) {
        return { ok: false as const, reason: "target_entry_not_permitted" };
      }
      if (targetCategory && targetCategory !== ownedCategory) {
        return { ok: false as const, reason: "target_category_mismatch" };
      }
    }
    const nextAction =
      input.disposition === "no_reusable_impact"
        // The exception path intentionally stopped before code linking and
        // registration. The Agent must re-declare with semanticImpact=none
        // (and remove a providerRecipe it judged local); claiming Runtime had
        // already resumed here would be false.
        ? "redeclaration_required" as const
        : input.disposition === "unresolved_conflict"
          ? "await_more_evidence" as const
          : "existing_rule_update_review" as const;
    const disposition = {
      disposition: input.disposition,
      rationale: input.rationale.trim(),
      evidence_record_ids: evidence,
      target_entry_id: targetEntryId,
      target_category: targetCategory,
      next_action: nextAction
    };
    const now = new Date().toISOString();
    const event = buildLoggedEvent("component_preview_exception_resolved", {
      exception_id: input.exceptionId,
      exception_digest: input.expectedDigest,
      ...disposition
    });
    const updated = db.prepare(
      `UPDATE component_preview_exceptions
       SET status = 'resolved', disposition_json = ?,
           disposition_event_id = ?, updated_at = ?, resolved_at = ?
       WHERE id = ? AND status = 'pending' AND exception_digest = ?`
    ).run(
      JSON.stringify(disposition),
      event.event_id,
      now,
      now,
      input.exceptionId,
      input.expectedDigest
    );
    if (updated.changes !== 1) {
      return { ok: false as const, reason: "exception_resolution_conflict" };
    }
    insertEvent(db, event);
    return {
      ok: true as const,
      exception_id: input.exceptionId,
      disposition: input.disposition,
      event_id: event.event_id,
      next_action: nextAction
    };
  });
}
