import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import { z } from "zod";

import { closeProjectDb, openProjectDb, withProjectTransaction } from "./db";
import { validateDesignSystemJson, type DesignSystemFileKind } from "./design-system-schema";
import { checkDesignSystemDeclarationLinksOnDb } from "./design-system-status";
import { logEventOnDb } from "./events";
import { requireProjectPhase } from "./project-phase";
import { recordSourceArtifact } from "./source-artifact";

const sourceRefs = z.array(z.string().trim().min(1)).min(1);
const tokenAddition = z.object({
  kind: z.literal("token"),
  layer: z.enum(["primitive", "semantic", "component"]),
  name: z.string().trim().min(1),
  domain: z.enum([
    "color", "typography", "spacing", "size", "ratio", "radius",
    "border", "shadow", "opacity"
  ]),
  value: z.unknown(),
  sourceRefs
}).strict();
const ruleAddition = <Kind extends "concept" | "layout-rule" | "interaction-rule">(
  kind: Kind
) =>
  z.object({
    kind: z.literal(kind),
    meaning: z.string().trim().min(1),
    value: z.string().trim().min(1),
    sourceRefs
  }).strict();
const componentAddition = z.object({
  kind: z.literal("component"),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  sourceRefs,
  props: z.array(z.record(z.string(), z.unknown())).default([]),
  variants: z.array(z.record(z.string(), z.unknown())).default([]),
  stateMatrix: z.array(z.record(z.string(), z.unknown())).default([]),
  guidelines: z.array(z.record(z.string(), z.unknown())).default([]),
  tokenLinks: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).default([]),
  codeLinks: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).default([]),
  group: z.enum(["component", "block"]).optional()
}).strict();

export const reviseDraftDesignSystemInputSchema = z.object({
  baseRevisionId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  additions: z.array(z.discriminatedUnion("kind", [
    tokenAddition,
    ruleAddition("concept"),
    ruleAddition("layout-rule"),
    ruleAddition("interaction-rule"),
    componentAddition
  ])).min(1)
}).strict();

export type ReviseDraftDesignSystemInput = z.infer<
  typeof reviseDraftDesignSystemInputSchema
>;

export type DesignSystemRevisionRecord = {
  id: string;
  sequence: number;
  parentRevisionId: string | null;
  status: "draft" | "formal";
  summary: string;
  digest: string;
  createdAt: string;
};

type StoredRevisionRow = {
  id: string;
  sequence: number;
  parent_revision_id: string | null;
  status: "draft" | "formal";
  summary: string;
  digest: string;
  created_at: string;
};

export type DesignSystemRevisionSnapshot = {
  name: string;
  entries: Array<Record<string, unknown>>;
  artifacts: unknown[];
};

type PendingArtifact = {
  path: string;
  artifactType: DesignSystemFileKind;
  value: Record<string, unknown>;
  relatedRecordIds: Set<string>;
};

function mapRevision(row: StoredRevisionRow): DesignSystemRevisionRecord {
  return {
    id: row.id,
    sequence: row.sequence,
    parentRevisionId: row.parent_revision_id,
    status: row.status,
    summary: row.summary,
    digest: row.digest,
    createdAt: row.created_at
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digestOf(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function snapshotOnDb(db: DatabaseType) {
  const meta = db.prepare(
    "SELECT name FROM design_system_meta WHERE singleton = 1"
  ).get() as { name: string } | undefined;
  const entries = db.prepare(
    `SELECT id, file_kind, section, entry_id, name, kind, domain, value_json,
            source_captures_json, meaning, status, links_json,
            source_artifact_path, position
     FROM design_system_entries
     ORDER BY source_artifact_path, position, entry_id`
  ).all() as Array<Record<string, unknown>>;
  const artifacts = db.prepare(
    `SELECT path, artifact_type, content_digest, declaration_version
     FROM source_artifacts
     WHERE path LIKE 'design-system/%'
     ORDER BY path`
  ).all();
  return {
    name: meta?.name ?? "",
    entries: entries.map((entry) => ({
      ...entry,
      value_json: JSON.parse(String(entry.value_json)),
      source_captures_json: JSON.parse(String(entry.source_captures_json ?? "[]")),
      links_json: JSON.parse(String(entry.links_json))
    })),
    artifacts
  };
}

function revisionStatusOnDb(db: DatabaseType): "draft" | "formal" {
  const row = db.prepare(
    "SELECT phase FROM project_phase WHERE singleton = 1"
  ).get() as { phase: string } | undefined;
  return row?.phase === "ready_for_new_design" ||
    row?.phase === "design_system_formal"
    ? "formal"
    : "draft";
}

export function readActiveDesignSystemRevisionOnDb(
  db: DatabaseType
): DesignSystemRevisionRecord | null {
  const row = db.prepare(
    `SELECT revision.*
     FROM design_system_revision_state state
     JOIN design_system_revisions revision
       ON revision.id = state.active_revision_id
     WHERE state.singleton = 1`
  ).get() as StoredRevisionRow | undefined;
  return row ? mapRevision(row) : null;
}

export function readActiveDesignSystemSnapshotOnDb(
  db: DatabaseType
): {
  revision: DesignSystemRevisionRecord;
  snapshot: DesignSystemRevisionSnapshot;
} | null {
  const row = db.prepare(
    `SELECT revision.*, revision.snapshot_json
     FROM design_system_revision_state state
     JOIN design_system_revisions revision
       ON revision.id = state.active_revision_id
     WHERE state.singleton = 1`
  ).get() as (StoredRevisionRow & { snapshot_json: string }) | undefined;
  if (!row) return null;
  return {
    revision: mapRevision(row),
    snapshot: JSON.parse(row.snapshot_json) as DesignSystemRevisionSnapshot
  };
}

export function ensureActiveDesignSystemRevisionOnDb(
  db: DatabaseType,
  summary = "Initial active Design System snapshot"
): DesignSystemRevisionRecord | null {
  const active = readActiveDesignSystemRevisionOnDb(db);
  if (active) return active;
  const snapshot = snapshotOnDb(db);
  if (snapshot.entries.length === 0) return null;
  const now = new Date().toISOString();
  const id = randomUUID();
  const digest = digestOf(snapshot);
  const status = revisionStatusOnDb(db);
  db.prepare(
    `INSERT INTO design_system_revisions
       (id, sequence, parent_revision_id, status, summary, digest,
        snapshot_json, created_at)
     VALUES (?, 1, NULL, ?, ?, ?, ?, ?)`
  ).run(id, status, summary, digest, JSON.stringify(snapshot), now);
  db.prepare(
    `UPDATE design_system_revision_state
     SET active_revision_id = ?, updated_at = ? WHERE singleton = 1`
  ).run(id, now);
  logEventOnDb(db, "design_system_revision_created", {
    revision_id: id,
    sequence: 1,
    parent_revision_id: null,
    status,
    digest,
    summary
  });
  logEventOnDb(db, "design_system_revision_activated", {
    revision_id: id,
    sequence: 1,
    digest
  });
  return { id, sequence: 1, parentRevisionId: null, status, summary, digest, createdAt: now };
}

export function ensureActiveDesignSystemRevision(
  projectPath: string
): DesignSystemRevisionRecord | null {
  return withProjectTransaction(projectPath, (db) =>
    ensureActiveDesignSystemRevisionOnDb(db)
  );
}

export function getEffectiveDesignSystem(projectPath: string) {
  const revision = ensureActiveDesignSystemRevision(projectPath);
  if (!revision) return { ok: false as const, reason: "design_system_empty" as const };
  const db = openProjectDb(projectPath);
  try {
    const active = readActiveDesignSystemSnapshotOnDb(db);
    if (!active) return { ok: false as const, reason: "design_system_empty" as const };
    return {
      ok: true as const,
      revision: active.revision,
      designSystem: active.snapshot,
      historyIncluded: false as const
    };
  } finally {
    closeProjectDb(db);
  }
}

export function getDesignSystemRevisionHistory(projectPath: string) {
  const db = openProjectDb(projectPath);
  try {
    const active = readActiveDesignSystemRevisionOnDb(db);
    const revisions = db.prepare(
      `SELECT id, sequence, parent_revision_id, status, summary, digest, created_at
       FROM design_system_revisions ORDER BY sequence DESC`
    ).all() as StoredRevisionRow[];
    return {
      ok: true as const,
      activeRevisionId: active?.id ?? null,
      revisions: revisions.map(mapRevision)
    };
  } finally {
    closeProjectDb(db);
  }
}

function slug(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function readObject(projectPath: string, relativePath: string): Record<string, unknown> {
  const value = JSON.parse(readFileSync(path.join(projectPath, relativePath), "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid_source:${relativePath}`);
  }
  return value as Record<string, unknown>;
}

function pendingArtifact(
  pending: Map<string, PendingArtifact>,
  projectPath: string,
  relativePath: string,
  artifactType: DesignSystemFileKind
): PendingArtifact {
  const existing = pending.get(relativePath);
  if (existing) return existing;
  const value = existsSync(path.join(projectPath, relativePath))
    ? readObject(projectPath, relativePath)
    : {};
  const artifact = {
    path: relativePath,
    artifactType,
    value,
    relatedRecordIds: new Set<string>()
  };
  pending.set(relativePath, artifact);
  return artifact;
}

function appendUnique(array: unknown[], entry: Record<string, unknown>, id: string) {
  if (array.some((candidate) =>
    candidate && typeof candidate === "object" &&
    !Array.isArray(candidate) &&
    (candidate as Record<string, unknown>).id === id
  )) throw new Error(`entry_already_exists:${id}`);
  array.push(entry);
}

function applyAddition(
  projectPath: string,
  pending: Map<string, PendingArtifact>,
  addition: ReviseDraftDesignSystemInput["additions"][number]
) {
  const links = [...new Set(addition.sourceRefs)];
  if (addition.kind === "token") {
    const artifact = pendingArtifact(
      pending, projectPath, "design-system/token.json", "token.json"
    );
    const layer = artifact.value[addition.layer];
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) {
      throw new Error(`invalid_source:design-system/token.json:${addition.layer}`);
    }
    const entries = layer as Record<string, unknown>;
    if (Object.hasOwn(entries, addition.name)) {
      throw new Error(`entry_already_exists:${addition.layer}.${addition.name}`);
    }
    entries[addition.name] = {
      kind: "token",
      domain: addition.domain,
      value: addition.value,
      status: "candidate",
      links
    };
    links.forEach((ref) => artifact.relatedRecordIds.add(ref));
    return;
  }

  if (addition.kind === "concept") {
    const artifact = pendingArtifact(
      pending, projectPath, "design-system/design-system.json", "design-system.json"
    );
    const concepts = artifact.value.concepts;
    if (!Array.isArray(concepts)) throw new Error("invalid_source:design-system/design-system.json:concepts");
    const id = `principle-${slug(addition.meaning)}`;
    appendUnique(concepts, {
      id,
      kind: "global-rule",
      value: addition.value,
      meaning: addition.meaning,
      status: "candidate",
      links
    }, id);
    links.forEach((ref) => artifact.relatedRecordIds.add(ref));
    return;
  }

  if (addition.kind === "layout-rule" || addition.kind === "interaction-rule") {
    const layout = addition.kind === "layout-rule";
    const relativePath = layout
      ? "design-system/layout-rules.json"
      : "design-system/interaction-rules.json";
    const artifact = pendingArtifact(
      pending,
      projectPath,
      relativePath,
      layout ? "layout-rules.json" : "interaction-rules.json"
    );
    const rules = artifact.value.rules;
    if (!Array.isArray(rules)) throw new Error(`invalid_source:${relativePath}:rules`);
    const id = `${layout ? "layout" : "interaction"}-${slug(addition.meaning)}`;
    appendUnique(rules, {
      id,
      kind: "domain-rule",
      value: addition.value,
      meaning: addition.meaning,
      status: "candidate",
      links
    }, id);
    links.forEach((ref) => artifact.relatedRecordIds.add(ref));
    return;
  }

  const componentSlug = slug(addition.name);
  const inventoryId = `component-${componentSlug}`;
  const specId = `component-spec-${componentSlug}`;
  const specPath = `design-system/components/${componentSlug}.json`;
  const inventory = pendingArtifact(
    pending, projectPath, "design-system/component-list.json", "component-list.json"
  );
  const components = inventory.value.components;
  if (!Array.isArray(components)) {
    throw new Error("invalid_source:design-system/component-list.json:components");
  }
  appendUnique(components, {
    id: inventoryId,
    value: { name: addition.name, specPath: `components/${componentSlug}.json` },
    meaning: `${addition.name} component`,
    status: "candidate",
    links
  }, inventoryId);
  links.forEach((ref) => inventory.relatedRecordIds.add(ref));

  const spec = pendingArtifact(pending, projectPath, specPath, "component-spec");
  if (Object.keys(spec.value).length > 0) throw new Error(`entry_already_exists:${specId}`);
  spec.value = {
    id: specId,
    name: addition.name,
    value: {
      description: addition.description,
      props: addition.props,
      variants: addition.variants,
      stateMatrix: addition.stateMatrix,
      guidelines: addition.guidelines,
      tokenLinks: addition.tokenLinks,
      codeLinks: addition.codeLinks,
      ...(addition.group ? { group: addition.group } : {})
    },
    status: "candidate",
    links
  };
  links.forEach((ref) => spec.relatedRecordIds.add(ref));
}

function writeJsonAtomically(projectPath: string, artifact: PendingArtifact) {
  const absolute = path.join(projectPath, artifact.path);
  mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.ikran-revision-${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(artifact.value, null, 2)}\n`, "utf8");
  renameSync(temporary, absolute);
}

export function reviseDraftDesignSystem(projectPath: string, rawInput: unknown) {
  const parsed = reviseDraftDesignSystemInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false as const, reason: "invalid_revision" as const, details: parsed.error.flatten() };
  }
  const input = parsed.data;
  const gate = requireProjectPhase(projectPath, "draft_design_system");
  if (!gate.ok) return gate;
  const inputDigest = digestOf(input);

  const preflight = withProjectTransaction(projectPath, (db) => {
    const prior = db.prepare(
      "SELECT input_digest, response_json FROM design_system_revision_requests WHERE idempotency_key = ?"
    ).get(input.idempotencyKey) as { input_digest: string; response_json: string } | undefined;
    if (prior) {
      return prior.input_digest === inputDigest
        ? { ok: true as const, reused: JSON.parse(prior.response_json) }
        : { ok: false as const, reason: "idempotency_conflict" as const };
    }
    const active = ensureActiveDesignSystemRevisionOnDb(db);
    if (!active) return { ok: false as const, reason: "design_system_empty" as const };
    if (active.id !== input.baseRevisionId) {
      return {
        ok: false as const,
        reason: "stale_revision" as const,
        activeRevisionId: active.id
      };
    }
    for (const addition of input.additions) {
      const checked = checkDesignSystemDeclarationLinksOnDb(db, addition.sourceRefs);
      if (!checked.ok) return { ok: false as const, reason: checked.reason, details: checked.details };
    }
    return { ok: true as const, active };
  });
  if (!preflight.ok) return preflight;
  if ("reused" in preflight) return { ...preflight.reused, reused: true };

  const pending = new Map<string, PendingArtifact>();
  try {
    for (const addition of input.additions) {
      applyAddition(projectPath, pending, addition);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const [reason, identity] = message.split(":", 2);
    return {
      ok: false as const,
      reason: reason === "entry_already_exists" ? reason : "invalid_source",
      details: { identity: identity ?? null, message }
    };
  }

  for (const artifact of pending.values()) {
    const validation = validateDesignSystemJson(artifact.artifactType, artifact.value);
    if (!validation.ok) {
      return {
        ok: false as const,
        reason: "invalid_projected_artifact" as const,
        details: { path: artifact.path, validation }
      };
    }
  }

  const backups = new Map<string, Buffer | null>();
  for (const artifact of pending.values()) {
    const absolute = path.join(projectPath, artifact.path);
    backups.set(artifact.path, existsSync(absolute) ? readFileSync(absolute) : null);
  }
  const restore = () => {
    for (const [relativePath, content] of backups) {
      const absolute = path.join(projectPath, relativePath);
      if (content === null) rmSync(absolute, { force: true });
      else writeFileSync(absolute, content);
    }
  };

  try {
    for (const artifact of pending.values()) writeJsonAtomically(projectPath, artifact);
    for (const artifact of pending.values()) {
      const declared = recordSourceArtifact(projectPath, {
        path: artifact.path,
        artifactType: artifact.artifactType,
        semanticPurpose: `Draft Design System revision: ${input.summary}`,
        relatedRecordIds: [...artifact.relatedRecordIds]
      });
      if (!declared.ok) {
        restore();
        return {
          ok: false as const,
          reason: declared.reason,
          details: declared.details,
          failedArtifact: artifact.path
        };
      }
    }
  } catch (error) {
    restore();
    return {
      ok: false as const,
      reason: "artifact_write_failed" as const,
      details: { message: error instanceof Error ? error.message : String(error) }
    };
  }

  return withProjectTransaction(projectPath, (db) => {
    const active = readActiveDesignSystemRevisionOnDb(db);
    if (!active || active.id !== input.baseRevisionId) {
      return {
        ok: false as const,
        reason: "stale_revision" as const,
        activeRevisionId: active?.id ?? null
      };
    }
    const snapshot = snapshotOnDb(db);
    const now = new Date().toISOString();
    const id = randomUUID();
    const sequence = active.sequence + 1;
    const digest = digestOf(snapshot);
    db.prepare(
      `INSERT INTO design_system_revisions
         (id, sequence, parent_revision_id, status, summary, digest,
          snapshot_json, created_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`
    ).run(id, sequence, active.id, input.summary, digest, JSON.stringify(snapshot), now);
    db.prepare(
      `UPDATE design_system_revision_state
       SET active_revision_id = ?, updated_at = ? WHERE singleton = 1`
    ).run(id, now);
    logEventOnDb(db, "design_system_revision_created", {
      revision_id: id,
      sequence,
      parent_revision_id: active.id,
      status: "draft",
      digest,
      summary: input.summary,
      additions: input.additions.length
    });
    const activation = logEventOnDb(db, "design_system_revision_activated", {
      revision_id: id,
      sequence,
      parent_revision_id: active.id,
      digest
    });
    const response = {
      ok: true as const,
      reused: false,
      revision: {
        id,
        sequence,
        parentRevisionId: active.id,
        status: "draft" as const,
        summary: input.summary,
        digest,
        createdAt: now
      },
      previousRevisionId: active.id,
      activeRevisionId: id,
      additionsApplied: input.additions.length,
      eventId: activation.event_id,
      projectPhase: "draft_design_system" as const
    };
    db.prepare(
      `INSERT INTO design_system_revision_requests
         (idempotency_key, input_digest, revision_id, response_json, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(input.idempotencyKey, inputDigest, id, JSON.stringify(response), now);
    return response;
  });
}
