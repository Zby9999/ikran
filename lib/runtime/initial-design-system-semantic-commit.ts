import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { closeProjectDb, openProjectDb, withProjectTransaction } from "./db";
import { deriveSourceCaptures } from "./design-system-source-capture";
import {
  claimInitialDesignSystemPreparation,
  finalizeInitialDesignSystemPreparation,
  recordDesignSystemExtractionAudit,
  recordDesignSystemExtractionWorkUnit,
  type DesignSystemExtractionWorkUnitClaimInput,
  type DesignSystemExtractionWorkUnitDefinition
} from "./initial-design-system-preparation";
import { recordSourceArtifact } from "./source-artifact";

const sourceIds = z.array(z.string().trim().min(1)).min(1);
const semanticRule = z.object({
  meaning: z.string().trim().min(1),
  value: z.string().trim().min(1),
  sourceRecordIds: sourceIds
}).strict();
const semanticToken = z.object({
  name: z.string().trim().min(1),
  domain: z.enum([
    "color", "typography", "spacing", "size", "ratio", "radius",
    "border", "shadow", "opacity"
  ]),
  value: z.unknown(),
  sourceRecordIds: sourceIds
}).strict();
const componentProp = z.object({
  name: z.string().trim().min(1),
  type: z.string().trim().min(1)
}).passthrough();
const componentVariant = z.object({
  axis: z.enum(["style", "size", "viewport"]),
  name: z.string().trim().min(1)
}).passthrough();
const componentState = z.object({
  state: z.string().trim().min(1)
}).passthrough();
const componentGuideline = z.object({
  kind: z.enum(["do", "dont"]),
  text: z.string().trim().min(1)
}).passthrough();

export const commitInitialDesignSystemSemanticInputSchema = z.object({
  alignmentAttemptId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
  designSystem: z.object({
    name: z.string().trim().min(1),
    visualLanguage: z.object({
      description: z.string().trim().min(1),
      meaning: z.string().trim().min(1),
      sourceRecordIds: sourceIds
    }).strict(),
    concepts: z.array(semanticRule).default([]),
    tokens: z.object({
      primitive: z.array(semanticToken).default([]),
      semantic: z.array(semanticToken).default([]),
      component: z.array(semanticToken).default([])
    }).strict(),
    layoutRules: z.array(semanticRule).default([]),
    interactionRules: z.array(semanticRule).default([]),
    components: z.array(z.object({
      name: z.string().trim().min(1),
      description: z.string().trim().min(1),
      sourceRecordIds: sourceIds,
      props: z.array(componentProp).default([]),
      variants: z.array(componentVariant).default([]),
      stateMatrix: z.array(componentState).default([]),
      guidelines: z.array(componentGuideline).default([]),
      tokenLinks: z.array(z.union([z.string().trim().min(1), z.record(z.string(), z.unknown())])).default([]),
      codeLinks: z.array(z.union([z.string().trim().min(1), z.record(z.string(), z.unknown())])).default([]),
      group: z.enum(["component", "block"]).optional()
    }).strict()).default([])
  }).strict()
}).strict();

export type CommitInitialDesignSystemSemanticInput = z.infer<
  typeof commitInitialDesignSystemSemanticInputSchema
>;

type SourceRecord = {
  id: string;
  excerpt: string;
  confidence: "confirmed" | "reasonable";
  anchorJson: string | null;
};

type ArtifactProjection = {
  path: string;
  artifactType:
    | "design-system.json"
    | "token.json"
    | "component-list.json"
    | "layout-rules.json"
    | "interaction-rules.json"
    | "component-spec";
  value: unknown;
  relatedRecordIds: string[];
};

type WorkUnitProjection = {
  key: string;
  definition: DesignSystemExtractionWorkUnitDefinition;
  claims: DesignSystemExtractionWorkUnitClaimInput[];
};

type SemanticCommitProjection = {
  artifacts: ArtifactProjection[];
  workUnits: WorkUnitProjection[];
  residualClaims: DesignSystemExtractionWorkUnitClaimInput[];
  checkedClaimIds: string[];
};

type CommitFailure = {
  ok: false;
  reason: string;
  details?: unknown;
  failedStage?: string;
};

function stableSlug(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (slug) return slug;
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function recordExcerpt(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  return "Alignment source record";
}

function sourceRecordsFromClaim(
  claimed: Extract<ReturnType<typeof claimInitialDesignSystemPreparation>, { ok: true }>
): Map<string, SourceRecord> {
  const records = new Map<string, SourceRecord>();
  for (const card of claimed.question_cards) {
    records.set(card.id, {
      id: card.id,
      excerpt: recordExcerpt(card.final_answer ?? card.proposed_answer ?? card.observation),
      confidence: "confirmed",
      anchorJson: JSON.stringify(card.anchor)
    });
  }
  for (const annotation of claimed.annotations) {
    records.set(annotation.id, {
      id: annotation.id,
      excerpt: recordExcerpt(annotation.body),
      confidence: annotation.inference,
      anchorJson: JSON.stringify(annotation.anchor)
    });
  }
  for (const annotation of claimed.designer_annotations) {
    const raw = annotation as unknown as Record<string, unknown>;
    records.set(String(raw.id), {
      id: String(raw.id),
      excerpt: recordExcerpt(raw.body),
      confidence: "confirmed",
      anchorJson: null
    });
  }
  return records;
}

function claimFor(input: {
  id: string;
  statement: string;
  sourceRecordIds: string[];
  sources: Map<string, SourceRecord>;
  targets: DesignSystemExtractionWorkUnitClaimInput["targets"];
  outcome?: "mapped" | "omitted";
  reason?: string;
}): DesignSystemExtractionWorkUnitClaimInput {
  const sourceRecordIds = unique(input.sourceRecordIds);
  const sourceRecords = sourceRecordIds.map((id) => input.sources.get(id)!);
  return {
    claimId: input.id,
    statement: input.statement,
    sourceRecordIds,
    sourceExcerpts: sourceRecords.map((record) => record.excerpt),
    confidence: sourceRecords.some((record) => record.confidence === "reasonable")
      ? "reasonable"
      : "confirmed",
    outcome: input.outcome ?? "mapped",
    ...(input.reason ? { reason: input.reason } : {}),
    targets: input.targets
  };
}

function fallbackOmissionClaim(input: {
  key: string;
  statement: string;
  sourceId: string;
  sources: Map<string, SourceRecord>;
}): DesignSystemExtractionWorkUnitClaimInput {
  return claimFor({
    id: `semantic:${input.key}:empty`,
    statement: input.statement,
    sourceRecordIds: [input.sourceId],
    sources: input.sources,
    targets: [],
    outcome: "omitted",
    reason: "No reusable decision for this work unit was present in the semantic extraction."
  });
}

function captureResolver(projectPath: string) {
  const db = openProjectDb(projectPath);
  const load = db.prepare(
    `SELECT id, screenshot_artifact_path, frame_bounds_json,
            positional_nodes_json, created_at
     FROM figma_evidence_surfaces WHERE id = ?`
  );
  const stale = db.prepare(
    `SELECT superseded_by FROM figma_evidence_surfaces WHERE id = ?`
  );
  return {
    derive(sourceRecordIds: string[], sources: Map<string, SourceRecord>) {
      return deriveSourceCaptures({
        projectPath,
        anchorJsons: sourceRecordIds
          .map((id) => sources.get(id)?.anchorJson)
          .filter((value): value is string => typeof value === "string"),
        loadSurface: (id) => load.get(id) as never,
        staleOf: (id) => {
          const row = stale.get(id) as { superseded_by: string | null } | undefined;
          return row === undefined || row.superseded_by !== null;
        }
      });
    },
    close() {
      closeProjectDb(db);
    }
  };
}

function projectSemanticBundle(
  projectPath: string,
  input: CommitInitialDesignSystemSemanticInput,
  sources: Map<string, SourceRecord>
): SemanticCommitProjection | CommitFailure {
  const allSourceIds = [
    input.designSystem.visualLanguage.sourceRecordIds,
    ...input.designSystem.concepts.map((item) => item.sourceRecordIds),
    ...Object.values(input.designSystem.tokens).flat().map((item) => item.sourceRecordIds),
    ...input.designSystem.layoutRules.map((item) => item.sourceRecordIds),
    ...input.designSystem.interactionRules.map((item) => item.sourceRecordIds),
    ...input.designSystem.components.map((item) => item.sourceRecordIds)
  ].flat();
  const unknownSourceIds = unique(allSourceIds).filter((id) => !sources.has(id));
  if (unknownSourceIds.length > 0) {
    return { ok: false, reason: "invalid_semantic_source", details: { sourceRecordIds: unknownSourceIds } };
  }
  const firstSourceId = sources.keys().next().value as string | undefined;
  if (!firstSourceId) return { ok: false, reason: "alignment_source_empty" };

  const ids = new Set<string>();
  const reserve = (kind: string, label: string) => {
    const id = `${kind}-${stableSlug(label)}`;
    if (ids.has(id)) throw new Error(`semantic_identity_collision:${id}`);
    ids.add(id);
    return id;
  };
  try {
    const visualId = "visual-language";
    ids.add(visualId);
    const conceptEntries = input.designSystem.concepts.map((item) => ({
      item,
      id: reserve("principle", item.meaning)
    }));
    const tokenEntries = (["primitive", "semantic", "component"] as const)
      .flatMap((layer) => input.designSystem.tokens[layer].map((item) => ({ layer, item })));
    const tokenIdentity = new Set<string>();
    for (const { layer, item } of tokenEntries) {
      const id = `${layer}.${item.name}`;
      if (tokenIdentity.has(id)) throw new Error(`semantic_identity_collision:${id}`);
      tokenIdentity.add(id);
    }
    const layoutEntries = input.designSystem.layoutRules.map((item) => ({
      item,
      id: reserve("layout", item.meaning)
    }));
    const interactionEntries = input.designSystem.interactionRules.map((item) => ({
      item,
      id: reserve("interaction", item.meaning)
    }));
    const componentEntries = input.designSystem.components.map((item) => ({
      item,
      inventoryId: reserve("component", item.name),
      specId: reserve("component-spec", item.name),
      specPath: `design-system/components/${stableSlug(item.name)}.json`
    }));

    const resolver = captureResolver(projectPath);
    let layoutRules: unknown[];
    let componentSpecs: Array<{ entry: (typeof componentEntries)[number]; value: unknown }>;
    try {
      layoutRules = layoutEntries.map(({ item, id }) => {
        const captures = resolver.derive(item.sourceRecordIds, sources);
        return {
          id,
          kind: "domain-rule",
          value: item.value,
          meaning: item.meaning,
          status: "candidate",
          links: unique(item.sourceRecordIds),
          ...(captures ? { sourceCaptures: captures } : {})
        };
      });
      componentSpecs = componentEntries.map((entry) => {
        const captures = resolver.derive(entry.item.sourceRecordIds, sources);
        return {
          entry,
          value: {
            id: entry.specId,
            name: entry.item.name,
            value: {
              description: entry.item.description,
              props: entry.item.props,
              stateMatrix: entry.item.stateMatrix,
              variants: entry.item.variants,
              guidelines: entry.item.guidelines,
              tokenLinks: entry.item.tokenLinks,
              codeLinks: entry.item.codeLinks,
              ...(entry.item.group ? { group: entry.item.group } : {}),
              ...(captures ? { sourceCaptures: captures } : {})
            },
            status: "candidate",
            links: unique(entry.item.sourceRecordIds)
          }
        };
      });
    } finally {
      resolver.close();
    }

    const artifacts: ArtifactProjection[] = [
      {
        path: "design-system/design-system.json",
        artifactType: "design-system.json",
        relatedRecordIds: unique([
          ...input.designSystem.visualLanguage.sourceRecordIds,
          ...input.designSystem.concepts.flatMap((item) => item.sourceRecordIds)
        ]),
        value: {
          name: input.designSystem.name,
          visualLanguage: {
            id: visualId,
            kind: "global-rule",
            value: { description: input.designSystem.visualLanguage.description },
            meaning: input.designSystem.visualLanguage.meaning,
            status: "candidate",
            links: unique(input.designSystem.visualLanguage.sourceRecordIds)
          },
          concepts: conceptEntries.map(({ item, id }) => ({
            id, kind: "global-rule", value: item.value, meaning: item.meaning,
            status: "candidate", links: unique(item.sourceRecordIds)
          }))
        }
      },
      {
        path: "design-system/token.json",
        artifactType: "token.json",
        relatedRecordIds: unique(tokenEntries.flatMap(({ item }) => item.sourceRecordIds)),
        value: Object.fromEntries((["primitive", "semantic", "component"] as const).map((layer) => [
          layer,
          Object.fromEntries(input.designSystem.tokens[layer].map((item) => [item.name, {
            kind: "token", domain: item.domain, value: item.value,
            status: "candidate", links: unique(item.sourceRecordIds)
          }]))
        ]))
      },
      {
        path: "design-system/component-list.json",
        artifactType: "component-list.json",
        relatedRecordIds: unique(componentEntries.flatMap(({ item }) => item.sourceRecordIds)),
        value: { components: componentEntries.map(({ item, inventoryId, specPath }) => ({
          id: inventoryId,
          value: { name: item.name, specPath: specPath.replace(/^design-system\//, "") },
          meaning: `${item.name} component`, status: "candidate",
          links: unique(item.sourceRecordIds)
        })) }
      },
      {
        path: "design-system/layout-rules.json",
        artifactType: "layout-rules.json",
        relatedRecordIds: unique(input.designSystem.layoutRules.flatMap((item) => item.sourceRecordIds)),
        value: { rules: layoutRules }
      },
      {
        path: "design-system/interaction-rules.json",
        artifactType: "interaction-rules.json",
        relatedRecordIds: unique(input.designSystem.interactionRules.flatMap((item) => item.sourceRecordIds)),
        value: { rules: interactionEntries.map(({ item, id }) => ({
          id, kind: "domain-rule", value: item.value, meaning: item.meaning,
          status: "candidate", links: unique(item.sourceRecordIds)
        })) }
      },
      ...componentSpecs.map(({ entry, value }) => ({
        path: entry.specPath,
        artifactType: "component-spec" as const,
        relatedRecordIds: unique(entry.item.sourceRecordIds),
        value
      }))
    ];

    const globalClaims = [
      claimFor({ id: "semantic:global:visual-language", statement: input.designSystem.visualLanguage.description,
        sourceRecordIds: input.designSystem.visualLanguage.sourceRecordIds, sources,
        targets: [{ artifactPath: "design-system/design-system.json", entryId: visualId }] }),
      ...conceptEntries.map(({ item, id }) => claimFor({ id: `semantic:global:${id}`, statement: item.value,
        sourceRecordIds: item.sourceRecordIds, sources,
        targets: [{ artifactPath: "design-system/design-system.json", entryId: id }] }))
    ];
    const tokenClaims = tokenEntries.map(({ layer, item }) => claimFor({
      id: `semantic:tokens:${stableSlug(`${layer}-${item.name}`)}`,
      statement: `${layer} token ${item.name}`,
      sourceRecordIds: item.sourceRecordIds, sources,
      targets: [{ artifactPath: "design-system/token.json", entryId: `${layer}.${item.name}` }]
    }));
    const layoutClaims = layoutEntries.map(({ item, id }) => claimFor({
      id: `semantic:layout:${id}`, statement: item.value,
      sourceRecordIds: item.sourceRecordIds, sources,
      targets: [{ artifactPath: "design-system/layout-rules.json", entryId: id }]
    }));
    const interactionClaims = interactionEntries.map(({ item, id }) => claimFor({
      id: `semantic:interaction:${id}`, statement: item.value,
      sourceRecordIds: item.sourceRecordIds, sources,
      targets: [{ artifactPath: "design-system/interaction-rules.json", entryId: id }]
    }));
    const workUnits: WorkUnitProjection[] = [
      { key: "global", definition: { kind: "global" }, claims: globalClaims },
      { key: "tokens", definition: { kind: "tokens", reviewedFoundationOwners: ["color", "typography", "material"] },
        claims: tokenClaims.length ? tokenClaims : [fallbackOmissionClaim({ key: "tokens", statement: "No reusable foundation token was extracted.", sourceId: firstSourceId, sources })] },
      { key: "layout", definition: { kind: "layout" },
        claims: layoutClaims.length ? layoutClaims : [fallbackOmissionClaim({ key: "layout", statement: "No reusable layout rule was extracted.", sourceId: firstSourceId, sources })] },
      { key: "interaction", definition: { kind: "interaction" },
        claims: interactionClaims.length ? interactionClaims : [fallbackOmissionClaim({ key: "interaction", statement: "No reusable interaction rule was extracted.", sourceId: firstSourceId, sources })] },
      ...componentEntries.map((entry) => {
        const mapped = claimFor({
          id: `semantic:component:${entry.inventoryId}`,
          statement: entry.item.description,
          sourceRecordIds: entry.item.sourceRecordIds,
          sources,
          targets: [
            { artifactPath: "design-system/component-list.json", entryId: entry.inventoryId },
            { artifactPath: entry.specPath, entryId: entry.specId }
          ]
        });
        const specValue = entry.item;
        const omittedFields = (["variants", "guidelines", "tokenLinks", "codeLinks"] as const)
          .filter((field) => specValue[field].length === 0)
          .map((field) => claimFor({
            id: `semantic:component:${entry.inventoryId}:omitted-${field}`,
            statement: `No ${field} decision was extracted for ${entry.item.name}.`,
            sourceRecordIds: entry.item.sourceRecordIds, sources,
            targets: [{ artifactPath: entry.specPath, entryId: entry.specId, fieldPath: ["value", field] }],
            outcome: "omitted",
            reason: `Alignment did not establish a reusable ${field} decision.`
          }));
        return {
          key: `component:${entry.inventoryId}`,
          definition: { kind: "component", componentEntryId: entry.inventoryId, specArtifactPath: entry.specPath },
          claims: [mapped, ...omittedFields]
        } satisfies WorkUnitProjection;
      })
    ];
    const consumed = new Set(workUnits.flatMap((unit) => unit.claims.flatMap((claim) => claim.sourceRecordIds)));
    const residualClaims = [...sources.values()]
      .filter((record) => !consumed.has(record.id))
      .map((record) => claimFor({
        id: `semantic:residual:${stableSlug(record.id)}`,
        statement: record.excerpt,
        sourceRecordIds: [record.id], sources, targets: [], outcome: "omitted",
        reason: "No additional reusable Design System decision was extracted from this Alignment record."
      }));
    return {
      artifacts,
      workUnits,
      residualClaims,
      checkedClaimIds: [
        ...workUnits.flatMap((unit) => unit.claims.map((claim) => claim.claimId)),
        ...residualClaims.map((claim) => claim.claimId)
      ]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "projection_failed";
    if (message.startsWith("semantic_identity_collision:")) {
      return { ok: false, reason: "semantic_identity_collision", details: { identity: message.split(":").slice(1).join(":") } };
    }
    return { ok: false, reason: "semantic_projection_failed", details: { message } };
  }
}

function writeJsonAtomically(projectPath: string, artifact: ArtifactProjection): void {
  const absolute = path.join(projectPath, artifact.path);
  mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.ikran-semantic-${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(artifact.value, null, 2)}\n`, "utf8");
  renameSync(temporary, absolute);
}

function requestDigest(input: CommitInitialDesignSystemSemanticInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function markSemanticRequest(
  projectPath: string,
  commandId: string,
  request: {
    idempotencyKey: string;
    digest: string;
    status: "in-progress" | "completed";
    response?: Record<string, unknown>;
  }
): CommitFailure | { ok: true; reused: boolean } {
  return withProjectTransaction(projectPath, (db) => {
    const row = db.prepare("SELECT payload_json FROM agent_commands WHERE id = ?").get(commandId) as { payload_json: string } | undefined;
    if (!row) return { ok: false, reason: "initial_design_system_command_missing" };
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    const existing = payload.semantic_commit as Record<string, unknown> | undefined;
    if (existing) {
      if (existing.idempotencyKey !== request.idempotencyKey || existing.digest !== request.digest) {
        return { ok: false, reason: "idempotency_conflict" };
      }
      if (existing.status === "completed") return { ok: true, reused: true };
    }
    db.prepare("UPDATE agent_commands SET payload_json = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify({ ...payload, semantic_commit: request }), new Date().toISOString(), commandId
    );
    return { ok: true, reused: false };
  });
}

function existingSemanticResponse(
  projectPath: string,
  idempotencyKey: string,
  digest: string
): CommitFailure | { ok: true; response: Record<string, unknown> | null } {
  const db = openProjectDb(projectPath);
  try {
    const row = db.prepare(
      `SELECT payload_json FROM agent_commands
       WHERE command_type = 'prepare_initial_design_system'
       ORDER BY created_at DESC LIMIT 1`
    ).get() as { payload_json: string } | undefined;
    if (!row) return { ok: true, response: null };
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    const existing = payload.semantic_commit as Record<string, unknown> | undefined;
    if (!existing) return { ok: true, response: null };
    if (existing.idempotencyKey !== idempotencyKey || existing.digest !== digest) {
      return { ok: false, reason: "idempotency_conflict" };
    }
    return {
      ok: true,
      response:
        existing.status === "completed" &&
        existing.response !== null &&
        typeof existing.response === "object" &&
        !Array.isArray(existing.response)
          ? existing.response as Record<string, unknown>
          : null
    };
  } finally {
    closeProjectDb(db);
  }
}

export function commitInitialDesignSystemSemantic(
  projectPath: string,
  rawInput: unknown
): CommitFailure | {
  ok: true;
  reused: boolean;
  alignmentAttemptId: string;
  artifactPaths: string[];
  workUnitKeys: string[];
  claimCount: number;
  result: Extract<ReturnType<typeof finalizeInitialDesignSystemPreparation>, { ok: true }>;
} {
  const parsed = commitInitialDesignSystemSemanticInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, reason: "invalid_semantic_bundle", details: parsed.error.flatten() };
  const input = parsed.data;
  const digest = requestDigest(input);
  const existing = existingSemanticResponse(
    projectPath,
    input.idempotencyKey,
    digest
  );
  if (!existing.ok) return { ...existing, failedStage: "idempotency" };
  if (existing.response) {
    return {
      ...(existing.response as unknown as {
        ok: true;
        alignmentAttemptId: string;
        artifactPaths: string[];
        workUnitKeys: string[];
        claimCount: number;
        result: Extract<ReturnType<typeof finalizeInitialDesignSystemPreparation>, { ok: true }>;
      }),
      reused: true
    };
  }
  const claimed = claimInitialDesignSystemPreparation(projectPath);
  if (!claimed.ok) return { ok: false, reason: claimed.reason, failedStage: "claim" };
  if (claimed.attempt.id !== input.alignmentAttemptId) {
    return { ok: false, reason: "stale_alignment_attempt", failedStage: "claim" };
  }
  const sources = sourceRecordsFromClaim(claimed);
  const projection = projectSemanticBundle(projectPath, input, sources);
  if ("ok" in projection) return { ...projection, failedStage: "projection" };
  const request = markSemanticRequest(projectPath, claimed.command.id, {
    idempotencyKey: input.idempotencyKey, digest, status: "in-progress"
  });
  if (!request.ok) return { ...request, failedStage: "idempotency" };

  for (const artifact of projection.artifacts) {
    try {
      writeJsonAtomically(projectPath, artifact);
    } catch (error) {
      return { ok: false, reason: "artifact_write_failed", failedStage: artifact.path,
        details: { message: error instanceof Error ? error.message : String(error) } };
    }
    const declared = recordSourceArtifact(projectPath, {
      path: artifact.path,
      artifactType: artifact.artifactType,
      semanticPurpose: "Runtime projection of the Agent semantic Draft Design System bundle",
      relatedRecordIds: artifact.relatedRecordIds
    });
    if (!declared.ok) return { ok: false, reason: declared.reason, details: declared.details, failedStage: `ingest:${artifact.path}` };
  }

  for (const unit of projection.workUnits) {
    const recorded = recordDesignSystemExtractionWorkUnit(projectPath, {
      alignmentAttemptId: input.alignmentAttemptId,
      idempotencyKey: `${input.idempotencyKey}:work-unit:${unit.key}`,
      workUnit: unit.definition,
      claims: unit.claims
    });
    if (!recorded.ok) return { ok: false, reason: recorded.reason, details: recorded.details, failedStage: `work-unit:${unit.key}` };
  }
  const audit = recordDesignSystemExtractionAudit(projectPath, {
    alignmentAttemptId: input.alignmentAttemptId,
    idempotencyKey: `${input.idempotencyKey}:audit`,
    residualClaims: projection.residualClaims,
    audit: { status: "passed", checkedClaimIds: projection.checkedClaimIds, issues: [] }
  });
  if (!audit.ok) return { ok: false, reason: audit.reason, details: audit.details, failedStage: "audit" };
  const finalized = finalizeInitialDesignSystemPreparation(projectPath, input.alignmentAttemptId);
  if (!finalized.ok) return { ok: false, reason: finalized.reason, details: finalized.details, failedStage: "finalize" };
  const success = {
    ok: true,
    reused: request.reused,
    alignmentAttemptId: input.alignmentAttemptId,
    artifactPaths: projection.artifacts.map((artifact) => artifact.path),
    workUnitKeys: projection.workUnits.map((unit) => unit.key),
    claimCount: projection.checkedClaimIds.length,
    result: finalized
  } as const;
  markSemanticRequest(projectPath, claimed.command.id, {
    idempotencyKey: input.idempotencyKey,
    digest,
    status: "completed",
    response: success
  });
  return success;
}
