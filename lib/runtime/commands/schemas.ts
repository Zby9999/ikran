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
      "Confirmed rule_update_proposals id this write realizes. Required for every Agent-authored Design System write from Prototype validation onward; it must belong to the current phase/review cycle and authorize this exact source path. Runtime rejects omission, stale-cycle/path-mismatched, unconfirmed, or unknown ids."
    ),
  usedCandidateIds: z
    .array(z.string())
    .optional()
    .describe(
      "design_system_entries ids (or entry_id) this write depended on that are still Candidate. Runtime validates each is status=candidate and records candidate_dependency_declared."
    ),
  componentPreview: z
    .object({
      runId: z.string(),
      surfaceId: z.string(),
      entryId: z.string(),
      modulePath: z.string(),
      exportName: z.string(),
      defaultArgs: z.record(z.string(), z.unknown()).optional(),
      stateArgs: z
        .record(z.string(), z.record(z.string(), z.unknown()))
        .optional(),
      semanticImpact: z
        .enum(["none", "possible"])
        .describe(
          "Agent judgment against the current component contract. Use none only when evidence proves this implementation changes no reusable semantics; possible creates a bounded exception instead of auto-formalizing."
        ),
      semanticEvidenceRecordIds: z.array(z.string()).optional(),
      providerRecipe: z.record(z.string(), z.unknown()).optional()
    })
    .optional()
    .describe(
      "Exact same-run component provenance. modulePath must equal this declaration's path; Runtime never guesses from a filename or display name. On success code linking and a shared Next App Router or Vite React Preview Registration are automatic; package version changes do not select the adapter."
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

export const backfillComponentCodeLinksInputShape = {
  mappings: z
    .array(
      z.object({
        entryId: z
          .string()
          .describe(
            "design_system_entries row id or entry_id of the component spec entry."
          ),
        codeLinks: z
          .array(z.string())
          .min(1)
          .describe(
            "Project-relative code file paths backing this entry. Every file must exist on disk and be declared via record_artifact_written (artifactType code or prototype); undeclared or missing paths are rejected."
          )
      })
    )
    .min(1)
} as const;

export const backfillComponentCodeLinksInputSchema = z.object(
  backfillComponentCodeLinksInputShape
);

// Strings (not enums) for kind / classification so the domain reasons
// invalid_proposal_kind / invalid_proposal_classification reach the caller.
const ruleUpdateCategoryInputSchema = z
  .string()
  .regex(
    /^(?:foundations\.(?:home|color|typography|materials|layout|interaction)|component:.+)$/
  )
  .describe(
    "Exact Rule Update category: foundations.home | foundations.color | foundations.typography | foundations.materials | foundations.layout | foundations.interaction | component:<component-list.json entry id>. Bare values such as layout are invalid."
  );

export const proposeRuleUpdateInputShape = {
  reviewId: z.string().optional(),
  kind: z
    .string()
    .optional()
    .describe("new | update | move | retire. Defaults to move."),
  classification: z
    .string()
    .optional()
    .describe(
      "local_exception | reusable_candidate | rule_conflict | open_gap | proposed_update | no_finding. Defaults to proposed_update."
    ),
  title: z.string().optional(),
  changeDescription: z.string().optional(),
  fullRuleBody: z.string().optional(),
  targetCategory: ruleUpdateCategoryInputSchema.optional(),
  sourceCategory: ruleUpdateCategoryInputSchema.optional(),
  reason: z.string(),
  affectedItems: z.array(z.string()),
  evidenceRecordIds: z.array(z.string()),
  sourceArtifactPath: z
    .string()
    .optional()
    .describe(
      "Artifact path this proposal may authorize. Required for move and retire; also supply it for new/update proposals that will write a Design System source in a Rule-Update-protected phase."
    ),
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

export const createRuleUpdateReviewInputShape = {
  context: z.string(),
  reconciliationId: z.string().optional()
} as const;
export const createRuleUpdateReviewInputSchema = z.object(
  createRuleUpdateReviewInputShape
);

export const publishRuleUpdateReviewInputShape = { reviewId: z.string() } as const;
export const publishRuleUpdateReviewInputSchema = z.object(
  publishRuleUpdateReviewInputShape
);

export const failRuleUpdateApplyInputShape = {
  commandId: z.string(),
  error: z.string()
} as const;
export const failRuleUpdateApplyInputSchema = z.object(
  failRuleUpdateApplyInputShape
);

export const retryRuleUpdateApplyInputShape = { commandId: z.string() } as const;
export const retryRuleUpdateApplyInputSchema = z.object(
  retryRuleUpdateApplyInputShape
);

const ruleUpdateTargetShape = {
  category: ruleUpdateCategoryInputSchema,
  sourceCategory: ruleUpdateCategoryInputSchema.optional(),
  sourceArtifactPath: z.string().optional(),
  entryId: z.string().optional(),
  proposedTargetPath: z.string().optional()
} as const;

export const reviseRuleUpdateProposalInputShape = {
  proposalId: z.string(),
  title: z.string(),
  changeDescription: z.string().optional(),
  fullRuleBody: z.string(),
  target: z.object(ruleUpdateTargetShape)
} as const;
export const reviseRuleUpdateProposalInputSchema = z.object(
  reviseRuleUpdateProposalInputShape
);

export const decideRuleUpdateProposalInputShape = {
  proposalId: z.string(),
  decision: z.enum(["accepted", "rejected"])
} as const;
export const decideRuleUpdateProposalInputSchema = z.object(
  decideRuleUpdateProposalInputShape
);

export const claimConsolidateReviewInputShape = {
  reconciliationId: z
    .string()
    .describe(
      "Completed bounded conversation reconciliation returned by reconcile_designer_conversation."
    )
} as const;

export const claimConsolidateReviewInputSchema = z.object(
  claimConsolidateReviewInputShape
);

export const dismissDesignerFeedbackInputShape = {
  feedbackIds: z.array(z.string()),
  disposition: z
    .enum([
      "local_only",
      "superseded",
      "open_gap",
      "process_only",
      "covered_by_existing_rule"
    ])
    .describe(
      "Typed reason no proposal is needed. A final_decision permits only covered_by_existing_rule; otherwise include it in a proposal's evidenceRecordIds."
    ),
  reason: z
    .string()
    .describe("Evidence-grounded explanation for this exact disposition."),
  existingRuleEntryId: z
    .string()
    .optional()
    .describe(
      "Required only for covered_by_existing_rule; use an exact non-retired design_system_entries.entry_id returned in the Consolidate draft contract."
    )
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
  routePath: z
    .string()
    .optional()
    .describe(
      "Absolute URL path of this previewable page inside the Runtime-owned dev server, for example `/` or `/projects/atlas`. Defaults to `/`; URLs, `//`, dot segments, query strings, fragments and backslashes are rejected."
    ),
  prototypeRoot: z
    .string()
    .optional()
    .describe(
      "Project-relative directory containing the declared package.json whose scripts.dev and dependencies/devDependencies define the Runtime-owned preview. Defaults to the project root."
    ),
  devCommand: z
    .string()
    .optional()
    .describe(
      "Dev server command Runtime runs with PORT injected. Defaults to `npm run dev`. The script must bind 127.0.0.1 and use PORT. Must be a plain package-manager script invocation; shell composition is rejected."
    ),
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

/** Normalized rect against the FULL page: x/y top-left, width/height in [0, 1]. */
export const ruleCaptureRectShape = {
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1)
} as const;

export const captureRuleScreenshotInputShape = {
  surfaceId: z
    .string()
    .describe("Prototype Evidence Surface id whose preview URL is captured."),
  fileName: z
    .string()
    .optional()
    .describe(
      "Output file name under design-system/captures/ (basename only). Defaults to rule-capture-<epochMs>.png."
    ),
  crop: z
    .object(ruleCaptureRectShape)
    .optional()
    .describe(
      "Normalized crop against the full page; absent captures the whole page."
    ),
  annotations: z
    .array(z.object(ruleCaptureRectShape))
    .optional()
    .describe(
      "Normalized highlight rects baked into the PNG as green annotation overlays."
    )
} as const;

export const captureRuleScreenshotInputSchema = z.object(
  captureRuleScreenshotInputShape
);

export const captureComponentCodeHeroInputShape = {
  entryId: z
    .string()
    .describe(
      "Component spec entry (row id or entry_id) whose codeLinks code is rendered."
    ),
  surfaceId: z
    .string()
    .describe(
      "Prototype Evidence Surface id whose preview URL renders the component's current code."
    ),
  fileName: z
    .string()
    .optional()
    .describe(
      "Output file name under design-system/captures/ (basename only). Defaults to code-capture-<entryId>-<epochMs>.png."
    ),
  crop: z
    .object(ruleCaptureRectShape)
    .optional()
    .describe(
      "Normalized crop against the full page; absent captures the whole page."
    ),
  harnessPath: z
    .string()
    .optional()
    .describe(
      'Optional live-render harness route YOU add to the prototype app (Issue 33): a same-origin relative path such as "/__ikran/component/button" that mounts this component standalone with default props and re-renders on the ?state=<name> query (state names come from the spec\'s stateMatrix — do not re-declare them). Pure presentation: no Runtime API calls. Reset html/body margin to 0 and overflow to hidden; wrap the specimen plus symmetric interaction halo in exactly one non-transformed `[data-ikran-component-root]` at non-negative document coordinates whose x + width fits the 1133px presentation viewport. Install sizing per default/state document and bind its href at install time. On mount, root ResizeObserver updates, and window resize, post `{ type: "ikran:component-size", version: 2, href, x: rect.left, y: rect.top, width: max(root.scrollWidth, rect.width), height: max(root.scrollHeight, rect.height) }`. The parent accepts geometry only from this iframe, preview origin, and current href, then centers and fits the measured root without changing the fixed presentation viewport; every default/state navigation reports independently. Legacy body-size/v1 messages are rejected. Declaring it upgrades the Design System Browser hero from this static capture to a live sandboxed iframe render of the current code; omit it to keep the static code-backed capture only.'
    )
} as const;

export const captureComponentCodeHeroInputSchema = z.object(
  captureComponentCodeHeroInputShape
);

export const declareComponentLiveHeroesInputShape = {
  mappings: z.array(
    z.object({
      entryId: z
        .string()
        .describe("Component spec row id or stable entry_id."),
      surfaceId: z
        .string()
        .describe("Ready, non-stale Prototype Evidence Surface id."),
      harnessPath: z
        .string()
        .describe(
          'Same-origin component route such as "/__ikran/component/button"; it must honor ?state=<name>.'
        ),
      harnessArtifactPath: z
        .string()
        .describe(
          'Project-relative harness source file already declared as a code/prototype artifact. Its default state must retain native pointer hover. It must reset html/body layout, wrap the specimen plus symmetric interaction halo in exactly one non-transformed `[data-ikran-component-root]` whose x + width fits the 1133px presentation viewport, and report version-2 `{ href, x, y, width, height }` bounds on mount, root ResizeObserver updates, and window resize so the Browser can validate each default/state navigation independently, center, fit, and proportionally scale it without changing the fixed presentation viewport. Legacy body-size/v1 reports are invalid. It must hide framework dev chrome inside the harness only (Next.js: nextjs-portal { display: none !important; }); do not disable dev indicators for the normal prototype.'
        )
    })
  )
} as const;

export const declareComponentLiveHeroesInputSchema = z.object(
  declareComponentLiveHeroesInputShape
);

export const scaffoldComponentHarnessInputShape = {
  helperPath: z
    .string()
    .describe(
      'Project-relative path for the Runtime-owned sizing helper, e.g. "prototype/src/lib/ikran-component-harness.ts". Must live inside the prototype app source tree so harness routes can import it; the file is written byte-identical every time and never overwritten when hand-edited (helper_file_conflict).'
    )
} as const;

export const scaffoldComponentHarnessInputSchema = z.object(
  scaffoldComponentHarnessInputShape
);

export const verifyComponentLiveHeroesInputShape = {
  entryIds: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict to these component spec entries (row id or entry_id). Omit to verify every component spec with a declared liveHero."
    ),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(60000)
    .optional()
    .describe(
      "Per-navigation geometry wait budget in ms (default 10000). Cold dev-server compiles can exceed the Workbench's 5s hero timeout."
    )
} as const;

export const verifyComponentLiveHeroesInputSchema = z.object(
  verifyComponentLiveHeroesInputShape
);

export const recordNewDesignRunInputShape = {
  runId: z
    .string()
    .describe(
      "Stable run id for this new design session; reuse it on later record_preview calls."
    ),
  intent: z
    .string()
    .describe(
      "Designer's new prototype intent for this run. This is the only non-design-system input allowed in generation."
    ),
  usedCandidateIds: z
    .array(z.string())
    .optional()
    .describe(
      "Candidate design_system_entries ids this run already plans to depend on."
    )
} as const;

export const recordNewDesignRunInputSchema = z.object(
  recordNewDesignRunInputShape
);

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
      "Card title. Format bounds and language follow the claimed section_contract question_title and output_language."
    ),
  question: z
    .string()
    .describe(
      "Question shown on the card. Language follows the claimed section_contract.output_language."
    ),
  answerOptions: z
    .array(z.string())
    .min(2)
    .describe(
      "Ordered Agent-prepared answer choices. Supply at least two meaningful, mutually distinguishable strings; Runtime trims, validates uniqueness, and assigns stable ids. Add more when useful; there is no fixed maximum and no Agent-authored Other choice."
    ),
  proposedAnswer: z
    .string()
    .optional()
    .describe(
      "Deprecated compatibility field. It never replaces answerOptions for newly created MCP cards."
    ),
  anchor: alignmentAnchorSchema
});

export const finalizeAlignmentPreparationInputSchema = z.object({
  alignmentAttemptId: z.string()
});

const incrementalPlanSourceRefSchema = z.object({
  sourceId: z.string(),
  digest: z.string()
}).strict();

const incrementalPlanDecisionSchema = z.object({
  decisionId: z.string(),
  outputConcern: z.string(),
  statement: z.string(),
  sourceRefs: z.array(incrementalPlanSourceRefSchema)
}).strict();

const incrementalPlanDraftCollectionTargetSchema = z.enum([
  "concepts",
  "tokens.primitive",
  "tokens.semantic",
  "tokens.component",
  "foundationRules",
  "layoutRules",
  "interactionRules",
  "components",
  "categoryOmissions",
  "sourceOmissions"
]);

const incrementalPlanDraftPatchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  visualLanguage: z.object({
    value: z.record(z.string(), z.unknown()),
    decisionId: z.string().trim().min(1)
  }).strict().optional(),
  upserts: z.array(z.object({
    target: incrementalPlanDraftCollectionTargetSchema,
    entryKey: z.string().trim().min(1).describe(
      "Stable Agent-chosen identity for this entry across retries and answer edits."
    ),
    value: z.record(z.string(), z.unknown()),
    decisionId: z.string().trim().min(1)
  }).strict()).default([]),
  retireEntryKeys: z.array(z.object({
    target: incrementalPlanDraftCollectionTargetSchema,
    entryKey: z.string().trim().min(1)
  }).strict()).optional()
}).strict();

export const readAlignmentSemanticDeltaInputSchema = z.object({
  alignmentAttemptId: z.string(),
  afterRevision: z.number().int().nonnegative().optional()
}).strict();

export const recordIncrementalDesignSystemPlanInputSchema = z.object({
  alignmentAttemptId: z.string(),
  idempotencyKey: z.string(),
  basePlanVersion: z.number().int().nonnegative(),
  baseRevision: z.number().int().nonnegative(),
  section: z.enum([
    "design-concept",
    "visual-language",
    "token",
    "layout",
    "component",
    "interaction"
  ]),
  sectionDigest: z.string(),
  decisions: z.array(incrementalPlanDecisionSchema),
  retireDecisionIds: z.array(z.string()).optional(),
  draftPatch: incrementalPlanDraftPatchSchema
}).strict();

export const commitIncrementalDesignSystemPlanInputSchema = z.object({
  alignmentAttemptId: z.string(),
  planVersion: z.number().int().positive(),
  idempotencyKey: z.string()
}).strict();

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
  z.object({
    kind: z.literal("tokens"),
    reviewedFoundationOwners: z
      .array(z.enum(["color", "typography", "material"]))
      .optional()
  }).strict(),
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
  title: z
    .string()
    .describe(
      "Short non-empty title. Language follows the claimed section_contract.output_language."
    ),
  body: z
    .string()
    .describe(
      "Confirmed observation or reasonable assumption. Language follows the claimed section_contract.output_language."
    ),
  anchor: alignmentAnchorSchema
});

export const appendAgentAnnotationInformationInputSchema = z.object({
  annotationId: z.string(),
  information: z.string()
});

export const designerAnswerIntentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("option"),
    optionId: z.string().describe(
      "Stable option id read from the owning Question card. Runtime derives answer text and provenance."
    )
  }).strict(),
  z.object({
    kind: z.literal("custom"),
    text: z.string().describe(
      "Designer-authored answer text. It remains designer-edited even when equal to an Agent choice label."
    )
  }).strict()
]);

export const recordDesignerAnswerInputShape = {
  questionCardId: z.string(),
  answer: designerAnswerIntentSchema.optional(),
  finalAnswer: z.string().optional().describe(
    "Deprecated compatibility payload accepted only for persisted legacy cards without answer options."
  )
} as const;

/** Object schema kept intact so the MCP SDK can advertise its JSON shape. */
export const recordDesignerAnswerToolInputSchema = z
  .object(recordDesignerAnswerInputShape)
  .describe(
    "Provide exactly one of answer (modern option/custom intent) or finalAnswer (legacy compatibility only)."
  );

/** Stricter parser for direct callers and tests; Runtime repeats the XOR gate. */
export const recordDesignerAnswerInputSchema =
  recordDesignerAnswerToolInputSchema.superRefine((value, context) => {
  if ((value.answer === undefined) === (value.finalAnswer === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide exactly one of answer or finalAnswer.",
      path: ["answer"]
    });
  }
  });

export const updateAlignmentQuestionTitleInputSchema = z.object({
  questionCardId: z.string(),
  title: z
    .string()
    .describe(
      "Replacement card title. Format bounds and language follow the claimed section_contract question_title and output_language."
    )
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
