import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { closeProjectDb, openProjectDb, withProjectTransaction } from "./db";
import { deriveSourceCaptures } from "./design-system-source-capture";
import { validateDesignSystemJson } from "./design-system-schema";
import {
  claimInitialDesignSystemPreparation,
  finalizeInitialDesignSystemPreparation,
  recordDesignSystemExtractionAudit,
  recordDesignSystemExtractionWorkUnit,
  type DesignSystemExtractionWorkUnitClaimInput,
  type DesignSystemExtractionWorkUnitDefinition
} from "./initial-design-system-preparation";
import { recordSourceArtifact } from "./source-artifact";
import { claimIncrementalPlanCommitInput } from "./alignment-incremental-planning";
import { resolveProjectArtifactPath } from "./evidence-package";
import {
  commitInitialDesignSystemSemanticInputSchema,
  type CommitInitialDesignSystemSemanticInput
} from "./initial-design-system-semantic-schema";

export {
  commitInitialDesignSystemSemanticInputSchema,
  type CommitInitialDesignSystemSemanticInput
} from "./initial-design-system-semantic-schema";

const SEMANTIC_PROJECTION_PURPOSE =
  "Runtime projection of the Agent semantic Draft Design System bundle";

type SourceRecord = {
  ref: string;
  id: string;
  excerpt: string;
  confidence: "confirmed" | "reasonable";
  anchorJson: string | null;
};

type ClaimedInitialDesignSystem = Extract<
  ReturnType<typeof claimInitialDesignSystemPreparation>,
  { ok: true }
>;

function numberedRef(prefix: "Q" | "A" | "D" | "S", index: number): string {
  return `${prefix}${String(index + 1).padStart(2, "0")}`;
}

function indexedSourceRecords(
  claimed: ClaimedInitialDesignSystem
): SourceRecord[] {
  return [
    ...claimed.question_cards.map((card, index) => ({
      ref: numberedRef("Q", index),
      id: card.id,
      excerpt: recordExcerpt(
        card.final_answer ?? card.proposed_answer ?? card.observation
      ),
      confidence: "confirmed" as const,
      anchorJson: JSON.stringify(card.anchor)
    })),
    ...claimed.annotations.map((annotation, index) => ({
      ref: numberedRef("A", index),
      id: annotation.id,
      excerpt: recordExcerpt(annotation.body),
      confidence: annotation.inference,
      anchorJson: JSON.stringify(annotation.anchor)
    })),
    ...claimed.designer_annotations.map((annotation, index) => {
      const raw = annotation as unknown as Record<string, unknown>;
      return {
        ref: numberedRef("D", index),
        id: String(raw.id),
        excerpt: recordExcerpt(raw.body),
        confidence: "confirmed" as const,
        anchorJson: null
      };
    })
  ];
}

export function claimInitialDesignSystemSemanticContext(projectPath: string) {
  const claimed = claimInitialDesignSystemPreparation(projectPath);
  if (!claimed.ok) return claimed;

  const sourceRefsById = new Map(
    indexedSourceRecords(claimed).map((source) => [source.id, source.ref])
  );
  return {
    ok: true as const,
    reused: claimed.reused,
    workflowStage: claimed.workflow.stage,
    commandStatus: claimed.command.status,
    alignmentAttemptId: claimed.attempt.id,
    designLanguageDescription:
      claimed.input_snapshot.data.design_language_description,
    seedReferences: claimed.input_snapshot.data.seed_references.map(
      (seed, index) => ({
        ref: numberedRef("S", index),
        frameName: seed.evidence_version.frame_name,
        fileKey: seed.file_key,
        nodeId: seed.node_id,
        referenceNote: seed.reference_note
      })
    ),
    sources: [
      ...claimed.question_cards.map((card) => ({
        ref: sourceRefsById.get(card.id)!,
        kind: "question" as const,
        section: card.section,
        title: card.observation,
        question: card.question,
        answer: card.final_answer,
        answerSource: card.answer_source,
        selectedOptionId: card.selected_option_id
      })),
      ...claimed.annotations.map((annotation) => ({
        ref: sourceRefsById.get(annotation.id)!,
        kind: "agent-annotation" as const,
        section: annotation.section,
        title: annotation.title,
        statement: annotation.body,
        confidence: annotation.inference,
        additionalInformation: annotation.additional_information
      })),
      ...claimed.designer_annotations.map((annotation) => {
        const raw = annotation as unknown as Record<string, unknown>;
        return {
          ref: sourceRefsById.get(String(raw.id))!,
          kind: "designer-annotation" as const,
          section: raw.section ?? null,
          statement: recordExcerpt(raw.body)
        };
      })
    ],
    nextAction: {
      tool: "commit_initial_design_system_semantics",
      sourceField: "sourceRefs",
      instruction:
        "Submit one semantic Draft using only the short Q/A/D refs above. Explicitly account for every source: map it to an output/category omission or add an Agent-authored sourceOmission; Runtime will reject unconsumed evidence and never invent an omission. Empty tokens/layout/interaction/components require an evidence-linked categoryOmission. Preserve all evidence-backed color roles plus color foundationRules. Typography facts stay primitive, and every distinct fontSize primitive also needs its own semantic/component role with one scalar fontSize and usedFor. Keep each Typography role identity concise canonical English for the Browser specimen, write usedFor in the designer's language, and do not use that role identity as a language precedent for other Draft copy. Runtime owns candidate lifecycle status. Never bundle a scale. Do not re-claim, inspect legacy extraction tools, read SQLite, or re-extract raw positional evidence."
    }
  };
}

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

type SemanticCommitSuccess = {
  ok: true;
  reused: boolean;
  alignmentAttemptId: string;
  artifactPaths: string[];
  workUnitKeys: string[];
  claimCount: number;
  draftReady: true;
  projectPhase: "draft_design_system";
  continuationRequired: false;
  terminalBoundary: "draft_design_system_review";
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

function stableClaimId(prefix: string, identity: string): string {
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 10);
  return `${prefix}:${stableSlug(identity)}:${digest}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function recordExcerpt(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  return "Alignment source record";
}

function sourceRecordsFromClaim(
  claimed: ClaimedInitialDesignSystem
): Map<string, SourceRecord> {
  const records = new Map<string, SourceRecord>();
  for (const record of indexedSourceRecords(claimed)) {
    records.set(record.ref, record);
    // Accept durable ids during the dev transition, but only advertise short refs.
    records.set(record.id, record);
  }
  return records;
}

function durableSourceIds(
  refs: string[],
  sources: Map<string, SourceRecord>
): string[] {
  return unique(refs.map((ref) => sources.get(ref)!.id));
}

function claimFor(input: {
  id: string;
  statement: string;
  sourceRefs: string[];
  sources: Map<string, SourceRecord>;
  targets: DesignSystemExtractionWorkUnitClaimInput["targets"];
  outcome?: "mapped" | "omitted";
  reason?: string;
}): DesignSystemExtractionWorkUnitClaimInput {
  const refs = unique(input.sourceRefs);
  const sourceRecords = refs.map((ref) => input.sources.get(ref)!);
  return {
    claimId: input.id,
    statement: input.statement,
    sourceRecordIds: unique(sourceRecords.map((record) => record.id)),
    sourceExcerpts: sourceRecords.map((record) => record.excerpt),
    confidence: sourceRecords.some((record) => record.confidence === "reasonable")
      ? "reasonable"
      : "confirmed",
    outcome: input.outcome ?? "mapped",
    ...(input.reason ? { reason: input.reason } : {}),
    targets: input.targets
  };
}

function categoryOmissionClaim(input: {
  key: string;
  statement: string;
  reason: string;
  sourceRefs: string[];
  sources: Map<string, SourceRecord>;
}): DesignSystemExtractionWorkUnitClaimInput {
  return claimFor({
    id: `semantic:${input.key}:empty`,
    statement: input.statement,
    sourceRefs: input.sourceRefs,
    sources: input.sources,
    targets: [],
    outcome: "omitted",
    reason: input.reason
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
    derive(sourceRefs: string[], sources: Map<string, SourceRecord>) {
      return deriveSourceCaptures({
        projectPath,
        anchorJsons: sourceRefs
          .map((ref) => sources.get(ref)?.anchorJson)
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
  const allSourceRefs = [
    input.designSystem.visualLanguage.sourceRefs,
    ...input.designSystem.concepts.map((item) => item.sourceRefs),
    ...Object.values(input.designSystem.tokens).flat().map((item) => item.sourceRefs),
    ...input.designSystem.foundationRules.map((item) => item.sourceRefs),
    ...input.designSystem.layoutRules.map((item) => item.sourceRefs),
    ...input.designSystem.interactionRules.map((item) => item.sourceRefs),
    ...input.designSystem.components.map((item) => item.sourceRefs),
    ...input.designSystem.categoryOmissions.map((item) => item.sourceRefs),
    ...input.designSystem.sourceOmissions.map((item) => [item.sourceRef])
  ].flat();
  const unknownSourceRefs = unique(allSourceRefs).filter((ref) => !sources.has(ref));
  if (unknownSourceRefs.length > 0) {
    return { ok: false, reason: "invalid_semantic_source", details: { sourceRefs: unknownSourceRefs } };
  }
  const firstSourceRef = sources.keys().next().value as string | undefined;
  if (!firstSourceRef) return { ok: false, reason: "alignment_source_empty" };
  const categoryOmissions = new Map(
    input.designSystem.categoryOmissions.map((omission) => [
      omission.category,
      omission
    ])
  );

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
    const foundationRuleEntries = input.designSystem.foundationRules.map((item) => ({
      layer: item.layer,
      item
    }));
    const tokenIdentity = new Set<string>();
    for (const { layer, item } of [...tokenEntries, ...foundationRuleEntries]) {
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
        const captures = resolver.derive(item.sourceRefs, sources);
        return {
          id,
          kind: "domain-rule",
          value: item.value,
          meaning: item.meaning,
          status: "candidate",
          links: durableSourceIds(item.sourceRefs, sources),
          ...(captures ? { sourceCaptures: captures } : {})
        };
      });
      componentSpecs = componentEntries.map((entry) => {
        const captures = resolver.derive(entry.item.sourceRefs, sources);
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
            links: durableSourceIds(entry.item.sourceRefs, sources)
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
          ...durableSourceIds(input.designSystem.visualLanguage.sourceRefs, sources),
          ...input.designSystem.concepts.flatMap((item) => durableSourceIds(item.sourceRefs, sources))
        ]),
        value: {
          name: input.designSystem.name,
          visualLanguage: {
            id: visualId,
            kind: "global-rule",
            value: { description: input.designSystem.visualLanguage.description },
            meaning: input.designSystem.visualLanguage.meaning,
            status: "candidate",
            links: durableSourceIds(input.designSystem.visualLanguage.sourceRefs, sources)
          },
          concepts: conceptEntries.map(({ item, id }) => ({
            id, kind: "global-rule", value: item.value, meaning: item.meaning,
            status: "candidate", links: durableSourceIds(item.sourceRefs, sources)
          }))
        }
      },
      {
        path: "design-system/token.json",
        artifactType: "token.json",
        relatedRecordIds: unique([
          ...tokenEntries.flatMap(({ item }) => durableSourceIds(item.sourceRefs, sources)),
          ...foundationRuleEntries.flatMap(({ item }) => durableSourceIds(item.sourceRefs, sources)),
          ...(tokenEntries.length === 0 && foundationRuleEntries.length === 0
            ? durableSourceIds(categoryOmissions.get("tokens")!.sourceRefs, sources)
            : [])
        ]),
        value: Object.fromEntries((["primitive", "semantic", "component"] as const).map((layer) => [
          layer,
          Object.fromEntries([
            ...input.designSystem.tokens[layer].map((item) => [item.name, {
              kind: "token", domain: item.domain, value: item.value,
              status: "candidate", links: durableSourceIds(item.sourceRefs, sources)
            }] as const),
            ...foundationRuleEntries
              .filter((entry) => entry.layer === layer)
              .map(({ item }) => [item.name, {
                kind: "domain-rule", domain: item.domain, value: item.value,
                meaning: item.meaning, status: "candidate",
                links: durableSourceIds(item.sourceRefs, sources)
              }] as const)
          ])
        ]))
      },
      {
        path: "design-system/component-list.json",
        artifactType: "component-list.json",
        relatedRecordIds: unique([
          ...componentEntries.flatMap(({ item }) => durableSourceIds(item.sourceRefs, sources)),
          ...(componentEntries.length === 0
            ? durableSourceIds(categoryOmissions.get("components")!.sourceRefs, sources)
            : [])
        ]),
        value: { components: componentEntries.map(({ item, inventoryId, specPath }) => ({
          id: inventoryId,
          value: { name: item.name, specPath: specPath.replace(/^design-system\//, "") },
          meaning: `${item.name} component`, status: "candidate",
          links: durableSourceIds(item.sourceRefs, sources)
        })) }
      },
      {
        path: "design-system/layout-rules.json",
        artifactType: "layout-rules.json",
        relatedRecordIds: unique([
          ...input.designSystem.layoutRules.flatMap((item) => durableSourceIds(item.sourceRefs, sources)),
          ...(layoutEntries.length === 0
            ? durableSourceIds(categoryOmissions.get("layout")!.sourceRefs, sources)
            : [])
        ]),
        value: { rules: layoutRules }
      },
      {
        path: "design-system/interaction-rules.json",
        artifactType: "interaction-rules.json",
        relatedRecordIds: unique([
          ...input.designSystem.interactionRules.flatMap((item) => durableSourceIds(item.sourceRefs, sources)),
          ...(interactionEntries.length === 0
            ? durableSourceIds(categoryOmissions.get("interaction")!.sourceRefs, sources)
            : [])
        ]),
        value: { rules: interactionEntries.map(({ item, id }) => ({
          id, kind: "domain-rule", value: item.value, meaning: item.meaning,
          status: "candidate", links: durableSourceIds(item.sourceRefs, sources)
        })) }
      },
      ...componentSpecs.map(({ entry, value }) => ({
        path: entry.specPath,
        artifactType: "component-spec" as const,
        relatedRecordIds: durableSourceIds(entry.item.sourceRefs, sources),
        value
      }))
    ];

    const globalClaims = [
      claimFor({ id: "semantic:global:visual-language", statement: input.designSystem.visualLanguage.description,
        sourceRefs: input.designSystem.visualLanguage.sourceRefs, sources,
        targets: [{ artifactPath: "design-system/design-system.json", entryId: visualId }] }),
      ...conceptEntries.map(({ item, id }) => claimFor({ id: `semantic:global:${id}`, statement: item.value,
        sourceRefs: item.sourceRefs, sources,
        targets: [{ artifactPath: "design-system/design-system.json", entryId: id }] }))
    ];
    const tokenClaims = tokenEntries.map(({ layer, item }) => claimFor({
      id: stableClaimId("semantic:tokens", `${layer}.${item.name}`),
      statement: `${layer} token ${item.name}`,
      sourceRefs: item.sourceRefs, sources,
      targets: [{ artifactPath: "design-system/token.json", entryId: `${layer}.${item.name}` }]
    }));
    const foundationRuleClaims = foundationRuleEntries.map(({ layer, item }) => claimFor({
      id: stableClaimId("semantic:tokens", `${layer}.${item.name}`),
      statement: item.value,
      sourceRefs: item.sourceRefs,
      sources,
      targets: [{ artifactPath: "design-system/token.json", entryId: `${layer}.${item.name}` }]
    }));
    const layoutClaims = layoutEntries.map(({ item, id }) => claimFor({
      id: `semantic:layout:${id}`, statement: item.value,
      sourceRefs: item.sourceRefs, sources,
      targets: [{ artifactPath: "design-system/layout-rules.json", entryId: id }]
    }));
    const interactionClaims = interactionEntries.map(({ item, id }) => claimFor({
      id: `semantic:interaction:${id}`, statement: item.value,
      sourceRefs: item.sourceRefs, sources,
      targets: [{ artifactPath: "design-system/interaction-rules.json", entryId: id }]
    }));
    const workUnits: WorkUnitProjection[] = [
      { key: "global", definition: { kind: "global" }, claims: globalClaims },
      { key: "tokens", definition: { kind: "tokens", reviewedFoundationOwners: ["color", "typography", "material"] },
        claims: tokenClaims.length || foundationRuleClaims.length
          ? [...tokenClaims, ...foundationRuleClaims]
          : [categoryOmissionClaim({ key: "tokens", ...categoryOmissions.get("tokens")!, sources })] },
      { key: "layout", definition: { kind: "layout" },
        claims: layoutClaims.length
          ? layoutClaims
          : [categoryOmissionClaim({ key: "layout", ...categoryOmissions.get("layout")!, sources })] },
      { key: "interaction", definition: { kind: "interaction" },
        claims: interactionClaims.length
          ? interactionClaims
          : [categoryOmissionClaim({ key: "interaction", ...categoryOmissions.get("interaction")!, sources })] },
      ...componentEntries.map((entry) => {
        const mapped = claimFor({
          id: `semantic:component:${entry.inventoryId}`,
          statement: entry.item.description,
          sourceRefs: entry.item.sourceRefs,
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
            sourceRefs: entry.item.sourceRefs, sources,
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
    const categoryResidualClaims = componentEntries.length === 0
      ? [categoryOmissionClaim({
          key: "components",
          ...categoryOmissions.get("components")!,
          sources
        })]
      : [];
    const consumed = new Set([
      ...workUnits.flatMap((unit) => unit.claims.flatMap((claim) => claim.sourceRecordIds)),
      ...categoryResidualClaims.flatMap((claim) => claim.sourceRecordIds)
    ]);
    const conflictingOmissions = input.designSystem.sourceOmissions
      .filter((omission) => consumed.has(sources.get(omission.sourceRef)!.id))
      .map((omission) => omission.sourceRef);
    if (conflictingOmissions.length > 0) {
      return {
        ok: false,
        reason: "semantic_source_disposition_conflict",
        details: { sourceRefs: conflictingOmissions }
      };
    }
    const sourceResidualClaims = input.designSystem.sourceOmissions.map((omission) => {
      const source = sources.get(omission.sourceRef)!;
      return claimFor({
        id: stableClaimId("semantic:residual", source.id),
        statement: omission.statement,
        sourceRefs: [omission.sourceRef],
        sources,
        targets: [],
        outcome: "omitted",
        reason: omission.reason
      });
    });
    const residualClaims = [...categoryResidualClaims, ...sourceResidualClaims];
    residualClaims.flatMap((claim) => claim.sourceRecordIds)
      .forEach((sourceId) => consumed.add(sourceId));
    const canonicalSources = [
      ...new Map([...sources.values()].map((record) => [record.id, record])).values()
    ];
    const unconsumedSourceRefs = canonicalSources
      .filter((record) => !consumed.has(record.id))
      .map((record) => record.ref);
    if (unconsumedSourceRefs.length > 0) {
      return {
        ok: false,
        reason: "unconsumed_alignment_sources",
        details: { sourceRefs: unconsumedSourceRefs }
      };
    }
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

function updateSemanticRequest(
  projectPath: string,
  commandId: string,
  request: {
    idempotencyKey: string;
    digest: string;
    status: "in-progress" | "failed" | "completed";
    response?: Record<string, unknown>;
    artifactPaths?: string[];
  }
): CommitFailure | { ok: true } {
  return withProjectTransaction(projectPath, (db) => {
    const row = db.prepare("SELECT payload_json FROM agent_commands WHERE id = ?").get(commandId) as { payload_json: string } | undefined;
    if (!row) return { ok: false, reason: "initial_design_system_command_missing" };
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    const existing = payload.semantic_commit as Record<string, unknown> | undefined;
    if (existing?.status === "completed" && request.status === "failed") {
      return { ok: true };
    }
    if (
      existing &&
      (existing.idempotencyKey !== request.idempotencyKey ||
        existing.digest !== request.digest)
    ) {
      return { ok: false, reason: "idempotency_conflict" };
    }
    db.prepare("UPDATE agent_commands SET payload_json = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify({ ...payload, semantic_commit: request }), new Date().toISOString(), commandId
    );
    return { ok: true };
  });
}

function beginSemanticRequest(
  projectPath: string,
  commandId: string,
  alignmentAttemptId: string,
  idempotencyKey: string,
  digest: string,
  artifactPaths: string[]
): CommitFailure | { ok: true; cleanupPaths: string[] } {
  return withProjectTransaction(projectPath, (db) => {
    const row = db.prepare(
      "SELECT payload_json FROM agent_commands WHERE id = ?"
    ).get(commandId) as { payload_json: string } | undefined;
    if (!row) return { ok: false, reason: "initial_design_system_command_missing" };
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    const existing = payload.semantic_commit as Record<string, unknown> | undefined;
    if (existing?.status === "completed") {
      return { ok: false, reason: "idempotency_conflict" };
    }
    if (existing?.status === "in-progress" && (
      existing.idempotencyKey !== idempotencyKey || existing.digest !== digest
    )) {
      return { ok: false, reason: "idempotency_conflict" };
    }
    if (existing?.status === "failed" &&
      existing.idempotencyKey === idempotencyKey && existing.digest !== digest) {
      return { ok: false, reason: "idempotency_conflict" };
    }

    const declaredCleanupPaths = (db.prepare(
      `SELECT path FROM source_artifacts WHERE semantic_purpose = ?`
    ).all(SEMANTIC_PROJECTION_PURPOSE) as Array<{ path: string }>).map(
      (artifact) => artifact.path
    );
    const storedCleanupPaths = Array.isArray(existing?.artifactPaths)
      ? existing.artifactPaths.filter(
          (artifactPath): artifactPath is string => typeof artifactPath === "string"
        )
      : [];
    const cleanupPaths = unique([...declaredCleanupPaths, ...storedCleanupPaths]);
    for (const artifactPath of cleanupPaths) {
      db.prepare(
        "DELETE FROM design_system_entries WHERE source_artifact_path = ?"
      ).run(artifactPath);
    }
    db.prepare(
      "DELETE FROM source_artifacts WHERE semantic_purpose = ?"
    ).run(SEMANTIC_PROJECTION_PURPOSE);
    db.prepare(
      "DELETE FROM design_system_extraction_manifest_requests WHERE alignment_attempt_id = ?"
    ).run(alignmentAttemptId);
    db.prepare(
      "DELETE FROM design_system_extraction_manifests WHERE alignment_attempt_id = ?"
    ).run(alignmentAttemptId);
    db.prepare(
      "UPDATE design_system_meta SET name = '', updated_at = ? WHERE singleton = 1"
    ).run(new Date().toISOString());
    db.prepare(
      "UPDATE agent_commands SET payload_json = ?, updated_at = ? WHERE id = ?"
    ).run(
      JSON.stringify({
        ...payload,
        semantic_commit: {
          idempotencyKey,
          digest,
          status: "in-progress",
          artifactPaths
        }
      }),
      new Date().toISOString(),
      commandId
    );
    return { ok: true, cleanupPaths };
  });
}

function cleanupSemanticProjectionFiles(
  projectPath: string,
  artifactPaths: string[]
): CommitFailure | null {
  try {
    for (const artifactPath of artifactPaths) {
      const absolute = resolveProjectArtifactPath(projectPath, artifactPath);
      if (!absolute) {
        return {
          ok: false,
          reason: "artifact_path_escape",
          details: { path: artifactPath }
        };
      }
      if (existsSync(absolute)) unlinkSync(absolute);
    }
    return null;
  } catch (error) {
    return {
      ok: false,
      reason: "artifact_cleanup_failed",
      details: { message: error instanceof Error ? error.message : String(error) }
    };
  }
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
    if (existing.status === "completed" &&
      (existing.idempotencyKey !== idempotencyKey || existing.digest !== digest)) {
      return { ok: false, reason: "idempotency_conflict" };
    }
    if (existing.status === "in-progress" &&
      (existing.idempotencyKey !== idempotencyKey || existing.digest !== digest)) {
      return { ok: false, reason: "idempotency_conflict" };
    }
    if (existing.status === "failed" &&
      existing.idempotencyKey === idempotencyKey && existing.digest !== digest) {
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
): CommitFailure | SemanticCommitSuccess {
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
      ...(existing.response as unknown as Omit<SemanticCommitSuccess, "reused">),
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
  for (const artifact of projection.artifacts) {
    const validation = validateDesignSystemJson(
      artifact.artifactType,
      artifact.value
    );
    if (!validation.ok) {
      return {
        ok: false,
        reason: "invalid_projected_artifact",
        details: { path: artifact.path, validation },
        failedStage: "projection"
      };
    }
  }
  const request = beginSemanticRequest(
    projectPath,
    claimed.command.id,
    input.alignmentAttemptId,
    input.idempotencyKey,
    digest,
    projection.artifacts.map((artifact) => artifact.path)
  );
  if (!request.ok) return { ...request, failedStage: "idempotency" };
  const failAfterBegin = (failure: CommitFailure): CommitFailure => {
    try {
      updateSemanticRequest(projectPath, claimed.command.id, {
        idempotencyKey: input.idempotencyKey,
        digest,
        status: "failed",
        response: failure,
        artifactPaths: projection.artifacts.map((artifact) => artifact.path)
      });
    } catch {
      // The original typed failure remains authoritative. A later retry can
      // still restart an in-progress request with the same key and digest.
    }
    return failure;
  };
  const cleanupFailure = cleanupSemanticProjectionFiles(
    projectPath,
    request.cleanupPaths
  );
  if (cleanupFailure) {
    return failAfterBegin({ ...cleanupFailure, failedStage: "cleanup" });
  }

  for (const artifact of projection.artifacts) {
    try {
      writeJsonAtomically(projectPath, artifact);
    } catch (error) {
      return failAfterBegin({
        ok: false,
        reason: "artifact_write_failed",
        failedStage: artifact.path,
        details: { message: error instanceof Error ? error.message : String(error) }
      });
    }
    const declared = recordSourceArtifact(projectPath, {
      path: artifact.path,
      artifactType: artifact.artifactType,
      semanticPurpose: SEMANTIC_PROJECTION_PURPOSE,
      relatedRecordIds: artifact.relatedRecordIds
    });
    if (!declared.ok) return failAfterBegin({
      ok: false,
      reason: declared.reason,
      details: declared.details,
      failedStage: `ingest:${artifact.path}`
    });
  }

  for (const unit of projection.workUnits) {
    const recorded = recordDesignSystemExtractionWorkUnit(projectPath, {
      alignmentAttemptId: input.alignmentAttemptId,
      idempotencyKey: `${input.idempotencyKey}:work-unit:${unit.key}`,
      workUnit: unit.definition,
      claims: unit.claims
    });
    if (!recorded.ok) return failAfterBegin({
      ok: false,
      reason: recorded.reason,
      details: recorded.details,
      failedStage: `work-unit:${unit.key}`
    });
  }
  const audit = recordDesignSystemExtractionAudit(projectPath, {
    alignmentAttemptId: input.alignmentAttemptId,
    idempotencyKey: `${input.idempotencyKey}:audit`,
    residualClaims: projection.residualClaims,
    audit: { status: "passed", checkedClaimIds: projection.checkedClaimIds, issues: [] }
  });
  if (!audit.ok) return failAfterBegin({
    ok: false,
    reason: audit.reason,
    details: audit.details,
    failedStage: "audit"
  });
  const success = {
    ok: true,
    reused: false,
    alignmentAttemptId: input.alignmentAttemptId,
    artifactPaths: projection.artifacts.map((artifact) => artifact.path),
    workUnitKeys: projection.workUnits.map((unit) => unit.key),
    claimCount: projection.checkedClaimIds.length,
    draftReady: true,
    projectPhase: "draft_design_system",
    continuationRequired: false,
    terminalBoundary: "draft_design_system_review"
  } as const;
  const finalized = finalizeInitialDesignSystemPreparation(
    projectPath,
    input.alignmentAttemptId,
    {
      semantic_commit: {
        idempotencyKey: input.idempotencyKey,
        digest,
        status: "completed",
        response: success
      }
    }
  );
  if (!finalized.ok) return failAfterBegin({
    ok: false,
    reason: finalized.reason,
    details: finalized.details,
    failedStage: "finalize"
  });
  return success;
}

export function commitIncrementalInitialDesignSystemPlan(
  projectPath: string,
  rawInput: unknown
):
  | (SemanticCommitSuccess & { planVersion: number; frozenRevision: number })
  | (CommitFailure & {
      fallback?: { tool: "claim_initial_design_system_preparation" };
      repair?: { tool: "resume_initial_design_system_planning" };
    }) {
  if (!rawInput || typeof rawInput !== "object") {
    return { ok: false, reason: "invalid_incremental_plan_commit" };
  }
  const input = rawInput as Record<string, unknown>;
  if (
    typeof input.alignmentAttemptId !== "string" ||
    !Number.isInteger(input.planVersion) ||
    typeof input.idempotencyKey !== "string" ||
    input.idempotencyKey.trim().length === 0
  ) {
    return { ok: false, reason: "invalid_incremental_plan_commit" };
  }
  const claimed = claimIncrementalPlanCommitInput(projectPath, {
    alignmentAttemptId: input.alignmentAttemptId,
    planVersion: input.planVersion as number
  });
  if (!claimed.ok) return claimed;
  const committed = commitInitialDesignSystemSemantic(projectPath, {
    alignmentAttemptId: input.alignmentAttemptId,
    idempotencyKey: input.idempotencyKey,
    designSystem: claimed.designSystem
  });
  return committed.ok
    ? {
        ...committed,
        planVersion: claimed.planVersion,
        frozenRevision: claimed.frozenRevision
      }
    : {
        ...committed,
        repair: { tool: "resume_initial_design_system_planning" }
      };
}
