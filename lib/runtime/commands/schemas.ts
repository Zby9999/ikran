// Shared transport-level Zod shapes for HTTP + MCP.
// Domain modules own validation *reasons*; these schemas only describe the
// expected JSON structure so the MCP SDK does not reject payloads before
// domain reasons can surface. Prefer z.string() over enums for fields that
// have domain invalid_* reasons.

import { z } from "zod";

export const registerSeedReferenceInputShape = {
  figmaSeedReference: z.string(),
  originalDesignIntent: z.string()
} as const;

export const registerSeedReferenceInputSchema = z.object(
  registerSeedReferenceInputShape
);

export const createOrOpenProjectInputShape = {
  path: z.string().optional()
} as const;

export const setupWorkspaceInputShape = {
  path: z.string()
} as const;

const frameBoundsShape = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
});

export const recordEvidencePackageInputShape = {
  figmaSeedReference: z.string().optional(),
  seedReferenceId: z.string().optional(),
  // Optional so missing_frame reaches domain instead of MCP InvalidParams.
  frame: z
    .object({
      nodeId: z.string(),
      name: z.string(),
      bounds: frameBoundsShape.optional()
    })
    .optional(),
  evidenceViews: z
    .object({
      // Strings (not enums) so invalid_evidence_views reaches domain.
      rawData: z.string(),
      screenshot: z.string()
    })
    .optional(),
  screenshot: z
    .object({
      artifactPath: z.string().optional(),
      dataUrl: z.string().optional()
    })
    .optional(),
  designSignals: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        evidence: z.string()
      })
    )
    .optional(),
  surfaceBounds: z
    .object({
      width: z.number(),
      height: z.number()
    })
    .optional()
} as const;

export const recordEvidencePackageInputSchema = z.object(
  recordEvidencePackageInputShape
);

const annotationRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number()
});

const annotationPointSchema = z.object({
  x: z.number(),
  y: z.number()
});

export const annotationTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("figma-surface"),
    evidenceVersionId: z.string()
  }),
  z.object({
    kind: z.literal("figma-node"),
    evidenceVersionId: z.string(),
    nodeId: z.string()
  }),
  z.object({
    kind: z.literal("figma-region"),
    surfaceArtifactId: z.string().optional(),
    surfaceNodeId: z.string().optional(),
    rect: annotationRectSchema.optional(),
    point: annotationPointSchema.optional()
  })
]);

export const createRegionAnnotationInputShape = {
  target: annotationTargetSchema.optional(),
  // Optional string (not enum) so missing_author / invalid_author reach domain.
  author: z.string().optional(),
  type: z.string().optional(),
  body: z.string().optional(),
  // Optional string (not enum) so missing_section / invalid_section reach domain.
  section: z.string().optional(),
  // Candidate ranking and primary confirmation are Runtime-owned follow-ups,
  // not competing fields on the create contract.
} as const;

export const createRegionAnnotationInputSchema = z.object(
  createRegionAnnotationInputShape
);

export const confirmAnnotationPrimaryInputSchema = z.object({
  annotationId: z.string(),
  evidenceVersionId: z.string(),
  sourceNodeId: z.string()
});

export const updateRegionAnnotationBodyInputSchema = z.object({
  annotationId: z.string(),
  body: z.string()
});

export const addSeedReferenceInputShape = {
  figmaSeedReference: z.string(),
  referenceNote: z.string().optional()
} as const;

export const addSeedReferenceInputSchema = z.object(addSeedReferenceInputShape);

export const refreshSeedReferenceInputShape = {
  seedReferenceId: z.string()
} as const;

export const refreshSeedReferenceInputSchema = z.object(
  refreshSeedReferenceInputShape
);

export const getSeedReferenceContextInputSchema = z.object({
  seedReferenceId: z.string()
});

export const getAnnotationNodeCandidatesInputSchema = z.object({
  surfaceId: z.string(),
  rect: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number()
  })
});

export const getCapturedNodeCorrespondenceInputSchema = z.object({
  seedReferenceId: z.string(),
  capturedNodeId: z.string()
});

export const updateSeedReferenceNoteInputShape = {
  id: z.string(),
  /** Pass "" to clear. Field is required so omit does not silently wipe the note. */
  referenceNote: z.string()
} as const;

export const updateSeedReferenceNoteInputSchema = z.object(
  updateSeedReferenceNoteInputShape
);

export const setDesignLanguageDescriptionInputShape = {
  designLanguageDescription: z.string()
} as const;

export const setDesignLanguageDescriptionInputSchema = z.object(
  setDesignLanguageDescriptionInputShape
);

export const connectFigmaInputShape = {
  token: z.string()
} as const;

export const connectFigmaInputSchema = z.object(connectFigmaInputShape);

export const recordArtifactWrittenInputShape = {
  path: z.string(),
  // String (not enum) so unknown_artifact_type reaches domain.
  artifactType: z.string(),
  semanticPurpose: z.string(),
  relatedRecordIds: z.array(z.string()).optional(),
  // Agent-declared build/preview readiness note; Runtime never verifies it.
  readiness: z.string().optional(),
  proposalId: z
    .string()
    .optional()
    .describe(
      "Confirmed rule_update_proposals id this write realizes. Required for rule-update writes; Runtime rejects an unconfirmed or unknown id."
    )
} as const;

export const recordArtifactWrittenInputSchema = z.object(
  recordArtifactWrittenInputShape
);

export const getDesignSystemComponentInputShape = {
  /** Inventory entry id or spec entry id of the component. */
  componentId: z.string()
} as const;

export const getDesignSystemComponentInputSchema = z.object(
  getDesignSystemComponentInputShape
);

export const approveDesignSystemEntryInputShape = {
  /** Project-relative source artifact path holding the entry. */
  sourceArtifactPath: z.string(),
  /** Entry identity inside the file (layer-qualified for tokens). */
  entryId: z.string(),
  /** Designer-selected destination status. */
  targetStatus: z.enum(["candidate", "formalized"])
} as const;

export const approveDesignSystemEntryInputSchema = z.object(
  approveDesignSystemEntryInputShape
);

export const editDesignSystemEntryInputShape = {
  sourceArtifactPath: z.string(),
  entryId: z.string(),
  field: z.enum(["meaning", "value", "value.description"]),
  text: z.string()
} as const;

export const editDesignSystemEntryInputSchema = z.object(
  editDesignSystemEntryInputShape
);

// Strings (not enums) for kind / classification so the domain reasons
// invalid_proposal_kind / invalid_proposal_classification reach the caller.
export const proposeRuleUpdateInputShape = {
  kind: z
    .string()
    .optional()
    .describe("new | update | move. Defaults to move."),
  classification: z
    .string()
    .optional()
    .describe(
      "local_exception | reusable_candidate | rule_conflict | open_gap | proposed_update | no_finding. Defaults to proposed_update."
    ),
  title: z.string().optional(),
  changeDescription: z.string().optional(),
  reason: z.string(),
  affectedItems: z.array(z.string()),
  evidenceRecordIds: z.array(z.string()),
  sourceArtifactPath: z.string().optional(),
  entryId: z.string().optional(),
  proposedTargetPath: z.string().optional()
} as const;

export const proposeRuleUpdateInputSchema = z.object(
  proposeRuleUpdateInputShape
);

export const confirmRuleUpdateInputShape = {
  proposalId: z.string()
} as const;

export const confirmRuleUpdateInputSchema = z.object(
  confirmRuleUpdateInputShape
);

export const cancelRuleUpdateInputShape = {
  proposalId: z.string()
} as const;

export const cancelRuleUpdateInputSchema = z.object(
  cancelRuleUpdateInputShape
);

export const claimConsolidateReviewInputShape = {} as const;

export const claimConsolidateReviewInputSchema = z.object(
  claimConsolidateReviewInputShape
);

export const dismissDesignerFeedbackInputShape = {
  feedbackIds: z.array(z.string()),
  reason: z
    .string()
    .describe("Why these feedback records need no rule change.")
} as const;

export const dismissDesignerFeedbackInputSchema = z.object(
  dismissDesignerFeedbackInputShape
);

export const recordPreviewInputShape = {
  runId: z
    .string()
    .describe(
      "Run grouping marker for this prototype build; reuse it to update the same run."
    ),
  sourceArtifactPath: z
    .string()
    .describe(
      "Project-relative path of the prototype/code artifact already declared via record_artifact_written."
    ),
  prototypeRoot: z
    .string()
    .optional()
    .describe(
      "Project-relative directory Runtime installs and starts the dev server in. Defaults to the project root."
    ),
  devCommand: z
    .string()
    .optional()
    .describe("Dev server command Runtime runs. Defaults to `npm run dev`."),
  surfaceKey: z
    .string()
    .optional()
    .describe(
      "Stable identity of one previewable page inside the run. Defaults to `default`."
    ),
  name: z.string().optional().describe("Display name for the surface."),
  seedReferenceIds: z
    .array(z.string())
    .optional()
    .describe(
      "Seed References this reconstruction was built from. Required during prototype_validation."
    ),
  evidenceVersionIds: z
    .array(z.string())
    .optional()
    .describe(
      "Figma Evidence Surface ids (evidence versions) used. Required during prototype_validation."
    )
} as const;

export const recordPreviewInputSchema = z.object(recordPreviewInputShape);

export const recordDesignerFeedbackInputShape = {
  summary: z
    .string()
    .describe(
      "One modification conclusion from host chat — not a per-turn transcript."
    ),
  runId: z
    .string()
    .describe("Run grouping marker for later Consolidate aggregation."),
  sessionId: z
    .string()
    .describe("Session grouping marker for later Consolidate aggregation."),
  evidenceSurfaceId: z.string().optional(),
  prototypeSurfaceId: z.string().optional(),
  regionAnnotationId: z.string().optional(),
  seedReferenceId: z.string().optional(),
  opaqueContext: z
    .unknown()
    .optional()
    .describe(
      "Opaque host context (e.g. browser DOM selector). Stored as-is; Runtime does not validate or map it."
    )
} as const;

export const recordDesignerFeedbackInputSchema = z.object(
  recordDesignerFeedbackInputShape
);

const alignmentEvidenceLinkShape = {
  seedReferenceId: z.string(),
  evidenceSurfaceId: z.string(),
  evidenceVersionId: z.string()
} as const;

const alignmentNormalizedRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
});

const alignmentEvidenceTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("surface").describe("Whole-Frame style question only; use inside a single anchor."),
    ...alignmentEvidenceLinkShape
  }),
  z.object({
    kind: z.literal("node").describe("One specific Figma element or component. Prefer this when positional evidence exposes an exact matching node."),
    ...alignmentEvidenceLinkShape,
    nodeId: z.string()
  }),
  z.object({
    kind: z.literal("region").describe("One specific free region only when no exact positional node represents the target; never use to approximate a whole Frame or an available node."),
    ...alignmentEvidenceLinkShape,
    rect: alignmentNormalizedRectSchema
  })
]);

export const alignmentAnchorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("single").describe("One surface, node, or region target."),
    target: alignmentEvidenceTargetSchema
  }),
  z.object({
    kind: z.literal("focus-target-set").describe("Two or more repeated/shared node or region targets; surface targets are invalid."),
    targets: z.array(alignmentEvidenceTargetSchema)
  })
]);

export const createAlignmentQuestionCardInputSchema = z.object({
  alignmentAttemptId: z.string(),
  idempotencyKey: z.string(),
  section: z.string(),
  observation: z
    .string()
    .describe(
      "Concise card title: a 2–5 word noun phrase, at most 48 characters. Do not use a sentence or repeat the question."
    ),
  question: z.string(),
  proposedAnswer: z.string().optional(),
  anchor: alignmentAnchorSchema
});

export const finalizeAlignmentPreparationInputSchema = z.object({
  alignmentAttemptId: z.string()
});

const designSystemExtractionTargetSchema = z.object({
  artifactPath: z.string(),
  entryId: z.string(),
  fieldPath: z.array(z.string()).optional()
}).strict();

const designSystemExtractionClaimSchema = z.object({
  claimId: z.string(),
  statement: z.string(),
  sourceRecordIds: z.array(z.string()),
  sourceExcerpts: z.array(z.string()),
  confidence: z.enum(["confirmed", "reasonable"]),
  outcome: z.enum(["mapped", "conflict", "omitted", "gap"]),
  reason: z.string().optional(),
  targets: z.array(designSystemExtractionTargetSchema)
}).strict();

const designSystemExtractionResidualClaimSchema = z.object({
  claimId: z.string(),
  statement: z.string(),
  sourceRecordIds: z.array(z.string()),
  sourceExcerpts: z.array(z.string()),
  confidence: z.enum(["confirmed", "reasonable"]),
  outcome: z.enum(["conflict", "omitted"]),
  reason: z.string(),
  targets: z.array(designSystemExtractionTargetSchema).length(0)
}).strict();

const designSystemExtractionActiveWorkUnitSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }).strict(),
  z.object({ kind: z.literal("tokens") }).strict(),
  z.object({ kind: z.literal("layout") }).strict(),
  z.object({ kind: z.literal("interaction") }).strict(),
  z.object({
    kind: z.literal("component"),
    componentEntryId: z.string(),
    specArtifactPath: z.string().optional(),
    retire: z.literal(false).optional()
  }).strict()
]);

const designSystemExtractionRetiredComponentWorkUnitSchema = z.object({
  kind: z.literal("component"),
  componentEntryId: z.string(),
  retire: z.literal(true)
}).strict();

export const recordDesignSystemExtractionWorkUnitInputSchema = z.object({
  alignmentAttemptId: z.string(),
  idempotencyKey: z.string(),
  workUnit: z.union([
    designSystemExtractionActiveWorkUnitSchema,
    designSystemExtractionRetiredComponentWorkUnitSchema
  ]),
  claims: z.array(designSystemExtractionClaimSchema)
}).strict();

export const recordDesignSystemExtractionAuditInputSchema = z.object({
  alignmentAttemptId: z.string(),
  idempotencyKey: z.string(),
  residualClaims: z.array(designSystemExtractionResidualClaimSchema),
  audit: z.object({
    status: z.enum(["passed", "failed"]),
    checkedClaimIds: z.array(z.string()),
    issues: z.array(z.string())
  }).strict()
}).strict();

export const finalizeInitialDesignSystemPreparationInputSchema = z.object({
  alignmentAttemptId: z.string()
});

export const createAgentAnnotationInputSchema = z.object({
  alignmentAttemptId: z.string(),
  idempotencyKey: z.string(),
  section: z.string(),
  inference: z.string(),
  title: z.string(),
  body: z.string(),
  anchor: alignmentAnchorSchema
});

export const appendAgentAnnotationInformationInputSchema = z.object({
  annotationId: z.string(),
  information: z.string()
});

export const recordDesignerAnswerInputSchema = z.object({
  questionCardId: z.string(),
  finalAnswer: z.string()
});

export const updateAlignmentQuestionTitleInputSchema = z.object({
  questionCardId: z.string(),
  title: z
    .string()
    .describe("Replacement 2–5 word noun-phrase title, at most 48 characters.")
});

export const updateAlignmentQuestionAnchorInputSchema = z.object({
  questionCardId: z.string(),
  anchor: alignmentAnchorSchema
});

export type CommandInputParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "invalid_params" };

/**
 * Shared HTTP transport parser. MCP uses the exact same Zod schema objects as
 * `inputSchema`, while HTTP routes call this helper before the domain command.
 * Domain-valid structure can still carry semantically invalid values so the
 * domain layer remains the single source of detailed reasons.
 */
export function parseCommandInput<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown
): CommandInputParseResult<z.infer<T>> {
  const parsed = schema.safeParse(input);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, reason: "invalid_params" };
}
