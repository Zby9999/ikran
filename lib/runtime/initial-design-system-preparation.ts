import path from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { getAlignmentPreparationOnDb } from "./alignment-preparation";
import { withProjectTransaction } from "./db";
import {
  getDesignIntentAlignmentOnDb
} from "./design-intent-alignment";
import { logEventOnDb } from "./events";
import { emitRecordEvent } from "./record-bus";
import { listDeclaredArtifacts } from "./source-artifact";
import { specPathMatchesSourceArtifact } from "./design-system-spec-path";
import { resolveProjectArtifactPath } from "./evidence-package";
import {
  LAYOUT_RULE_CAPTURE_FIELD,
  LAYOUT_RULE_CAPTURE_NODE_RECT_FIELD,
  LAYOUT_RULE_CAPTURE_OPTIONAL_FIELDS,
  LAYOUT_RULE_CAPTURE_REQUIRED_FIELDS,
  COMPONENT_SPEC_VALUE_FIELDS,
  DESIGN_SYSTEM_ENTRY_KINDS,
  DESIGN_SYSTEM_ENTRY_KIND_FILE_OWNERSHIP,
  RICH_COMPONENT_SPEC_FIELDS,
  TOKEN_DOMAINS
} from "./design-system-schema";

export const INITIAL_DESIGN_SYSTEM_REQUIRED_ARTIFACTS = [
  "design-system/design-system.json",
  "design-system/token.json",
  "design-system/component-list.json",
  "design-system/layout-rules.json",
  "design-system/interaction-rules.json"
] as const;

const REQUIRED_ARTIFACT_TYPES = {
  "design-system/design-system.json": "design-system.json",
  "design-system/token.json": "token.json",
  "design-system/component-list.json": "component-list.json",
  "design-system/layout-rules.json": "layout-rules.json",
  "design-system/interaction-rules.json": "interaction-rules.json"
} as const;

const RULE_BODY_WRITING_STYLE = {
  shape: "Every global, domain, layout, and interaction rule value is one non-empty prose string.",
  rules: [
    "Write the complete reusable decision as concise prose in value; use multiple sentences only when needed to preserve evidence-backed nuance.",
    "Keep the stable rule title in meaning as one sentence.",
    "Use the language of the designer's source text; if the designer writes Chinese, write the extracted rules in Chinese.",
    "Do not restate existing rules or generalize beyond the evidence; unsupported ideas belong in open questions, not source rules.",
    "Do not precompute affected items inside a rule body; derive them from the complete current rule set when proposing a change."
  ],
  examples: {
    layout: {
      good: {
        value: "项目图片组成横向轨道，图片尺寸为 461.25 × 446px，间距为 20px；窄屏支持触控横向滚动，并保留右侧裁切提示。",
        meaning: "横向画廊用于连续浏览项目。"
      },
      bad: {
        value: { gap: "20px", imageSize: "461.25 × 446px" }
      }
    },
    interaction: {
      good: {
        value: "高频工具中的动效只用于解释状态变化。使用短促反馈确认系统已响应，避免循环或装饰性动效；减少动态效果时保留等价的状态信息。",
        meaning: "动效服务理解，不争夺注意力。"
      },
      bad: {
        value: { motion: "160ms ease-out" }
      }
    }
  }
} as const;

const TYPOGRAPHY_ROLE_WRITING_STYLE = {
  role_value_fields: [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "textTransform"
  ],
  rules: [
    "Represent every reusable type style as one complete composite token; keep atomic typography tokens as referenced construction facts.",
    "Semantic and component layer tokens use the token identity for the stable role name and write value.usedFor as one sentence about usage context, function, or design intent.",
    "Do not repeat the role name with only size, role, or token appended.",
    "Do not invent usage or missing font fields; preserve unsupported facts as explicit gaps."
  ],
  examples: {
    good: {
      name: "typography.connectHeading",
      value: {
        fontFamily: { alias: "semantic.typography.brandFamily" },
        fontSize: { alias: "primitive.fontSize.37" },
        fontWeight: { alias: "primitive.fontWeight.regular" },
        lineHeight: { alias: "primitive.lineHeight.100" },
        letterSpacing: { alias: "primitive.letterSpacing.tight" },
        usedFor: "Closing-section call to action."
      }
    },
    bad: {
      name: "typography.connectHeadingSize",
      value: {
        alias: "primitive.fontSize.37",
        usedFor: "Connect call-to-action heading size role."
      }
    }
  }
} as const;

export const INITIAL_DESIGN_SYSTEM_SOURCE_CONTRACT = {
  schema_version: 3,
  source_root: "design-system",
  file_layout: [
    ...INITIAL_DESIGN_SYSTEM_REQUIRED_ARTIFACTS,
    "design-system/components/<name>.json"
  ],
  entry_envelope: ["kind", "value", "meaning", "status", "links"],
  entry_envelope_policy: {
    meaning:
      "meaning is a required stable title for rules only. Token entries and component specs do not write meaning."
  },
  entry_kinds: DESIGN_SYSTEM_ENTRY_KINDS,
  entry_kind_file_ownership: DESIGN_SYSTEM_ENTRY_KIND_FILE_OWNERSHIP,
  token_domains: TOKEN_DOMAINS,
  token_usage_policy: {
    primitive:
      "Primitive tokens carry construction facts only and write neither meaning nor a usage field.",
    typography:
      "Semantic and component typography tokens may write one non-empty value.usedFor sentence in the designer's source language.",
    other_domains:
      "Semantic and component tokens outside typography may write one non-empty value.usage sentence in the designer's source language.",
    fail_closed:
      "Token meaning is forbidden. Using usage or usedFor in the wrong layer or domain is rejected."
  },
  token_open_gap_policy: {
    representation: "domain-rule",
    status: "gap",
    links: "Open-gap rules carry an empty links array.",
    guidance:
      "Write evidence-backed unresolved token decisions as domain rules in the affected domain's Rules list. Put the stable question in meaning and the known context plus next action in the prose value. Never infer a gap from an unconsumed primitive or impose a palette size without project evidence."
  },
  component_spec_fields: COMPONENT_SPEC_VALUE_FIELDS,
  component_spec_writing_policy: {
    value_keys:
      "component_spec_fields is the closed value-key registry; custom keys are rejected instead of being silently dropped.",
    description:
      "Write component prose in value.description; do not write meaning on component-spec entries.",
    variants:
      'Write every visual choice as a variants row with axis: "style", axis: "size", or axis: "viewport"; do not create separate size or responsive fields.',
    states:
      "Write component-bound behavior, transitions, motion, and reduced-motion facts on the matching stateMatrix row.",
    guidelines:
      "Write every designer-facing usage, content, boundary, and human-readable verification rule as one guidelines row with an explicit do/dont kind.",
    unresolved_questions:
      "Keep unresolved questions in residual extraction claims and lineage; do not repeat workflow state inside the component spec."
  },
  component_group_field: {
    field: "group",
    values: ["component", "block"],
    guidance:
      "Optional sidebar grouping (09C-D03). Default \"component\"; declare " +
      "\"block\" only for page-structure composites that are not " +
      "independently reusable (sticky navigation bars, page shells, hero " +
      "sections). Absent stays valid and renders with the components."
  },
  component_capture_field: {
    field: "sourceCaptures",
    item_required: LAYOUT_RULE_CAPTURE_REQUIRED_FIELDS,
    item_optional: [
      ...LAYOUT_RULE_CAPTURE_OPTIONAL_FIELDS,
      LAYOUT_RULE_CAPTURE_NODE_RECT_FIELD
    ],
    guidance:
      "Optional per-component captures (09C-D03, same shape and crop " +
      "contract as layout_rule_capture_field). Two honest origins only: a " +
      "screenshot of the source design node, or (after the first prototype) " +
      "a code-backed capture of the real component. One primary capture per " +
      "component is enough — show the component in context. When neither " +
      "origin exists, omit the field and let the browser render the honest " +
      "unavailable block — never fabricate a capture; the agent can be " +
      "asked to produce a code-backed one later."
  },
  rule_body: {
    applies_to: ["global-rule", "domain-rule"],
    field: "value",
    type: "non-empty prose string"
  },
  layout_rule_capture_field: {
    field: LAYOUT_RULE_CAPTURE_FIELD,
    item_required: LAYOUT_RULE_CAPTURE_REQUIRED_FIELDS,
    item_optional: [
      ...LAYOUT_RULE_CAPTURE_OPTIONAL_FIELDS,
      LAYOUT_RULE_CAPTURE_NODE_RECT_FIELD
    ],
    guidance:
      "Optional per-rule Figma node screenshots (09C-D02, locator view v2). " +
      "Capture the node with the Figma MCP (get_screenshot on the rule's " +
      "frame/section node), then crop the PNG to a fixed-ratio region that " +
      "contains the node: 3:2 for landscape nodes, 2:3 for portrait ones. " +
      "Pick the crop orientation from the node's own shape so they agree — " +
      "a near-square node (pixel aspect between 2:3 and 3:2) takes 3:2; " +
      "the browser derives figure orientation from the nodeRect fraction " +
      "aspect, and a mismatched crop letterboxes the image and drifts the " +
      "position mark off the node. When the node is larger than the frame " +
      "region, keep the top part and let the rest truncate — the figure is " +
      "a locator, not a full view. Export at the exact ratio (the browser " +
      "renders with object-fit contain). Save the PNG under " +
      "design-system/captures/<entry>-<node>.png and reference the " +
      "project-relative path as artifactPath. nodeName and capturedAt are " +
      "required; add nodeId and surfaceId when the provenance is known so " +
      "the browser can mark stale captures. Add nodeRect — the node's " +
      "bounds inside the cropped PNG as fractions {x, y, width, height}, " +
      "computed deterministically from Figma node metadata — so the browser " +
      "can draw a position mark (skipped when the node nearly fills the " +
      "capture). Schema bounds: x and y within [0, 1]; width and height " +
      "within (0, 4] — values above 1 are expected when the crop truncates " +
      "the node. Rules without captures render an honest unavailable " +
      "block — never fabricate one."
  },
  interaction_entry_split: {
    interaction_rules: "Cross-component interaction and motion strategies only.",
    component_specs:
      "Component-bound behavior and motion belong on stateMatrix rows in the matching component spec."
  },
  rule_taxonomy: {
    interaction_rules: "Cross-component interaction and motion strategies.",
    component_specs: "Component-bound behavior, states, and motion.",
    layout_rules: "Spatial composition and layout behavior.",
    self_audit:
      "When writing a rule, inspect existing rules in that file for placement. Propose misplaced-rule moves through the rule-update proposal channel; never move rules silently."
  },
  typography_role_writing_style: TYPOGRAPHY_ROLE_WRITING_STYLE,
  rule_body_writing_style: RULE_BODY_WRITING_STYLE
} as const;

type InitialDesignSystemCommandFailureReason =
  | "no_pending_initial_design_system_command"
  | "db_error";

type InitialDesignSystemCommandFailure = {
  ok: false;
  reason: InitialDesignSystemCommandFailureReason;
};

type FrozenInitialDesignSystemInput = {
  input_snapshot: NonNullable<
    ReturnType<typeof getAlignmentPreparationOnDb>["input_snapshot"]
  >;
  annotations: ReturnType<
    typeof getDesignIntentAlignmentOnDb
  >["annotations"];
  question_cards: ReturnType<
    typeof getDesignIntentAlignmentOnDb
  >["question_cards"];
  designer_annotations: ReturnType<
    typeof getDesignIntentAlignmentOnDb
  >["designer_annotations"];
};

export type DesignSystemExtractionOutcome =
  | "mapped"
  | "conflict"
  | "omitted"
  | "gap";


export type DesignSystemExtractionAudit = {
  status: "passed" | "failed";
  checkedClaimIds: string[];
  issues: string[];
};


export const DESIGN_SYSTEM_EXTRACTION_WORK_UNIT_KINDS = [
  "global",
  "tokens",
  "layout",
  "interaction",
  "component"
] as const;

export type DesignSystemExtractionWorkUnitDefinition =
  | { kind: "global" }
  | { kind: "tokens" }
  | { kind: "layout" }
  | { kind: "interaction" }
  | {
      kind: "component";
      componentEntryId: string;
      specArtifactPath?: string;
      retire?: boolean;
    };

export type DesignSystemExtractionWorkUnitTargetInput = {
  artifactPath: string;
  entryId: string;
  fieldPath?: string[];
};

export type DesignSystemExtractionWorkUnitTarget =
  DesignSystemExtractionWorkUnitTargetInput & {
    jsonPointer: string;
  };

export type DesignSystemExtractionWorkUnitClaimInput = {
  claimId: string;
  statement: string;
  sourceRecordIds: string[];
  sourceExcerpts: string[];
  confidence: "confirmed" | "reasonable";
  outcome: DesignSystemExtractionOutcome;
  reason?: string;
  targets: DesignSystemExtractionWorkUnitTargetInput[];
};

export type DesignSystemExtractionWorkUnitClaim = Omit<
  DesignSystemExtractionWorkUnitClaimInput,
  "targets"
> & {
  targets: DesignSystemExtractionWorkUnitTarget[];
};

export type RecordDesignSystemExtractionWorkUnitInput = {
  alignmentAttemptId: string;
  idempotencyKey: string;
  workUnit: DesignSystemExtractionWorkUnitDefinition;
  claims: DesignSystemExtractionWorkUnitClaimInput[];
};

export type RecordDesignSystemExtractionAuditInput = {
  alignmentAttemptId: string;
  idempotencyKey: string;
  residualClaims: DesignSystemExtractionWorkUnitClaimInput[];
  audit: DesignSystemExtractionAudit;
};

type StoredDesignSystemExtractionWorkUnit = {
  key: string;
  kind: DesignSystemExtractionWorkUnitDefinition["kind"];
  definition: DesignSystemExtractionWorkUnitDefinition;
  claims: DesignSystemExtractionWorkUnitClaimInput[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type DesignSystemExtractionWorkUnitRecord = {
  key: string;
  kind: StoredDesignSystemExtractionWorkUnit["kind"];
  definition: DesignSystemExtractionWorkUnitDefinition;
  claims: DesignSystemExtractionWorkUnitClaim[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type DesignSystemExtractionWorkUnitRecoveryRecord =
  | DesignSystemExtractionWorkUnitRecord
  | (StoredDesignSystemExtractionWorkUnit & {
      resolutionError: {
        reason: "manifest_target_not_found" | "manifest_target_field_not_found";
        details?: Record<string, unknown>;
      };
    });

type ProgressiveDesignSystemExtractionManifest = {
  schemaVersion: 2;
  workUnits: StoredDesignSystemExtractionWorkUnit[];
  residualClaims: DesignSystemExtractionWorkUnitClaimInput[];
  audit: DesignSystemExtractionAudit | null;
};

export type DesignSystemExtractionProgress = {
  completedWorkUnitKeys: string[];
  consumedSourceRecordIds: string[];
  remainingQuestionCardIds: string[];
  remainingAgentAnnotationIds: string[];
  remainingDesignerAnnotationIds: string[];
  auditStatus: "pending" | "passed" | "failed";
  readyToFinalize: boolean;
};


function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function frozenInputFromCommandPayload(
  payload: Record<string, unknown>
): FrozenInitialDesignSystemInput | null {
  const raw = payload.initial_design_system_input;
  if (
    !isRecord(raw) ||
    !isRecord(raw.input_snapshot) ||
    !Array.isArray(raw.annotations) ||
    !Array.isArray(raw.question_cards) ||
    !Array.isArray(raw.designer_annotations)
  ) {
    return null;
  }
  return raw as unknown as FrozenInitialDesignSystemInput;
}

function ensureFrozenInputOnDb(
  db: DatabaseType,
  state: ReturnType<typeof getAlignmentPreparationOnDb>,
  command: ReturnType<
    typeof getAlignmentPreparationOnDb
  >["commands"][number]
): FrozenInitialDesignSystemInput {
  const existing = frozenInputFromCommandPayload(command.payload);
  if (existing) return existing;

  const inputSnapshot = state.input_snapshot;
  if (!inputSnapshot) {
    throw new Error("Initial Design System command has no input snapshot");
  }
  const alignment = getDesignIntentAlignmentOnDb(db);
  const frozen: FrozenInitialDesignSystemInput = {
    input_snapshot: inputSnapshot,
    annotations: alignment.annotations,
    question_cards: alignment.question_cards,
    designer_annotations: alignment.designer_annotations
  };
  db.prepare(
    `UPDATE agent_commands
     SET payload_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    JSON.stringify({
      ...command.payload,
      initial_design_system_input: frozen
    }),
    new Date().toISOString(),
    command.id
  );
  return frozen;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value: unknown, allowEmpty = false): value is string[] {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every(nonEmptyString)
  );
}


/**
 * Claim the durable Initial Design System preparation command and return its
 * complete immutable Alignment context. The Alignment attempt is completed
 * before this stage, so assembling the semantic read after the claim
 * transaction cannot observe a moving question/answer snapshot.
 */
export function claimInitialDesignSystemPreparation(
  projectPath: string
) {
  try {
    const claimed = withProjectTransaction(projectPath, (db) => {
      const state = getAlignmentPreparationOnDb(db);
      const attempt = state.current_attempt;
      const command = state.commands.find(
        (candidate) =>
          candidate.command_type === "prepare_initial_design_system"
      );
      if (
        state.workflow.stage !== "initial-design-system-preparing" ||
        attempt?.status !== "completed" ||
        !state.input_snapshot ||
        !command ||
        (command.status !== "pending" && command.status !== "claimed")
      ) {
        return {
          ok: false,
          reason: "no_pending_initial_design_system_command"
        } as InitialDesignSystemCommandFailure;
      }

      const frozenInput = ensureFrozenInputOnDb(db, state, command);
      if (command.status === "claimed") {
        return {
          ok: true as const,
          reused: true,
          workflow: state.workflow,
          command,
          attempt,
          frozen_input: frozenInput,
          progressive_extraction: progressiveExtractionStateOnDb(
            db,
            frozenInput,
            attempt.id
          ),
          event_id: null
        };
      }

      const now = new Date().toISOString();
      db.prepare(
        `UPDATE agent_commands
         SET status = 'claimed', claimed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      ).run(now, now, command.id);
      const event = logEventOnDb(db, "agent_command_claimed", {
        agent_command_id: command.id,
        command_type: command.command_type,
        alignment_attempt_id: attempt.id,
        input_snapshot_id: state.input_snapshot.id
      });
      const updated = getAlignmentPreparationOnDb(db);
      return {
        ok: true as const,
        reused: false,
        workflow: updated.workflow,
        command: updated.commands.find(
          (candidate) => candidate.id === command.id
        )!,
        attempt: updated.current_attempt!,
        frozen_input: frozenInput,
        progressive_extraction: progressiveExtractionStateOnDb(
          db,
          frozenInput,
          attempt.id
        ),
        event_id: event.event_id
      };
    });

    if (!claimed.ok) return claimed;

    const {
      frozen_input: frozenInput,
      progressive_extraction: progressiveExtraction,
      ...claimRecord
    } = claimed;
    const result = {
      ...claimRecord,
      input_snapshot: frozenInput.input_snapshot,
      annotations: frozenInput.annotations,
      question_cards: frozenInput.question_cards,
      designer_annotations: frozenInput.designer_annotations,
      extraction_work_units: progressiveExtraction.workUnits,
      extraction_residual_claims: progressiveExtraction.residualClaims,
      extraction_audit: progressiveExtraction.audit,
      extraction_progress: progressiveExtraction.progress,
      source_contract: INITIAL_DESIGN_SYSTEM_SOURCE_CONTRACT,
      required_artifacts: [...INITIAL_DESIGN_SYSTEM_REQUIRED_ARTIFACTS],
      declared_artifacts: listDeclaredArtifacts(projectPath)
    };

    if (!claimed.reused) {
      emitRecordEvent({
        kind: "alignment",
        action: "updated",
        id: claimed.attempt.id,
        projectPath: path.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return {
      ok: false,
      reason: "db_error"
    } as InitialDesignSystemCommandFailure;
  }
}


type ProgressiveExtractionFailure = {
  ok: false;
  reason:
    | "invalid_work_unit"
    | "duplicate_claim_id"
    | "invalid_manifest_source"
    | "claim_confidence_exceeds_source"
    | "work_unit_artifact_not_ingested"
    | "work_unit_target_out_of_scope"
    | "component_work_unit_mismatch"
    | "component_capture_missing"
    | "manifest_target_not_found"
    | "manifest_target_field_not_found"
    | "invalid_audit"
    | "input_coverage_incomplete"
    | "manifest_audit_incomplete"
    | "stale_alignment_attempt"
    | "initial_design_system_command_not_claimed"
    | "idempotency_conflict"
    | "db_error";
  details?: Record<string, unknown>;
};

function progressiveManifestFromRow(
  row: Record<string, unknown> | undefined
): ProgressiveDesignSystemExtractionManifest {
  if (!row) {
    return {
      schemaVersion: 2,
      workUnits: [],
      residualClaims: [],
      audit: null
    };
  }
  const parsed = JSON.parse(String(row.manifest_json)) as unknown;
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 2 ||
    !Array.isArray(parsed.workUnits) ||
    !Array.isArray(parsed.residualClaims)
  ) {
    throw new Error("legacy_extraction_manifest_not_supported");
  }
  return parsed as unknown as ProgressiveDesignSystemExtractionManifest;
}

function extractionWorkUnitKey(
  definition: DesignSystemExtractionWorkUnitDefinition
): string {
  return definition.kind === "component"
    ? `component:${definition.componentEntryId}`
    : definition.kind;
}

function workUnitArtifactPaths(
  definition: DesignSystemExtractionWorkUnitDefinition
): string[] {
  if (definition.kind === "global") {
    return ["design-system/design-system.json"];
  }
  if (definition.kind === "tokens") {
    return ["design-system/token.json"];
  }
  if (definition.kind === "layout") {
    return ["design-system/layout-rules.json"];
  }
  if (definition.kind === "interaction") {
    return ["design-system/interaction-rules.json"];
  }
  return [
    "design-system/component-list.json",
    ...(definition.specArtifactPath ? [definition.specArtifactPath] : [])
  ];
}

function missingComponentCaptures(
  projectPath: string,
  specEntries: DesignSystemEntryKeyRow[]
): Array<{ entry_id: string; artifact_path: string }> {
  return specEntries.flatMap((entry) => {
    const value = JSON.parse(entry.value_json) as Record<string, unknown>;
    const captures =
      value.sourceCaptures === undefined
        ? []
        : Array.isArray(value.sourceCaptures)
          ? value.sourceCaptures
          : [value.sourceCaptures];
    return captures.flatMap((capture) => {
      const artifactPath =
        isRecord(capture) && typeof capture.artifactPath === "string"
          ? capture.artifactPath
          : "";
      const absolutePath = artifactPath
        ? resolveProjectArtifactPath(projectPath, artifactPath)
        : null;
      let isFile = false;
      try {
        isFile =
          absolutePath !== null &&
          existsSync(absolutePath) &&
          statSync(absolutePath).isFile();
      } catch {
        isFile = false;
      }
      return isFile
        ? []
        : [{ entry_id: entry.entry_id, artifact_path: artifactPath }];
    });
  });
}

function progressiveExtractionProgress(
  frozenInput: FrozenInitialDesignSystemInput,
  manifest: ProgressiveDesignSystemExtractionManifest,
  expectedComponentWorkUnitKeys: string[] = []
): DesignSystemExtractionProgress {
  const claims = [
    ...manifest.workUnits.flatMap((workUnit) => workUnit.claims),
    ...manifest.residualClaims
  ];
  const consumed = new Set(claims.flatMap((claim) => claim.sourceRecordIds));
  const remainingQuestionCardIds = frozenInput.question_cards
    .filter((card) => card.status === "answered" && !consumed.has(card.id))
    .map((card) => card.id);
  const remainingAgentAnnotationIds = frozenInput.annotations
    .filter((annotation) => !consumed.has(annotation.id))
    .map((annotation) => annotation.id);
  const remainingDesignerAnnotationIds = frozenInput.designer_annotations
    .filter((annotation) => !consumed.has(annotation.id))
    .map((annotation) => annotation.id);
  const auditStatus = manifest.audit?.status ?? "pending";
  const completedWorkUnitKeys = manifest.workUnits.map(
    (workUnit) => workUnit.key
  );
  const requiredUnitsComplete = [
    "global",
    "tokens",
    "layout",
    "interaction",
    ...expectedComponentWorkUnitKeys
  ].every((key) => completedWorkUnitKeys.includes(key));
  const hasConflict = claims.some((claim) => claim.outcome === "conflict");
  return {
    completedWorkUnitKeys,
    consumedSourceRecordIds: [...consumed],
    remainingQuestionCardIds,
    remainingAgentAnnotationIds,
    remainingDesignerAnnotationIds,
    auditStatus,
    readyToFinalize:
      auditStatus === "passed" &&
      (manifest.audit?.issues.length ?? 0) === 0 &&
      requiredUnitsComplete &&
      !hasConflict &&
      remainingQuestionCardIds.length === 0 &&
      remainingAgentAnnotationIds.length === 0 &&
      remainingDesignerAnnotationIds.length === 0
  };
}

function componentWorkUnitKeys(entries: DesignSystemEntryKeyRow[]): string[] {
  return entries
    .filter((entry) => entry.section === "components.inventory")
    .map((entry) => `component:${entry.entry_id}`);
}

function componentWorkUnitKeysOnDb(db: DatabaseType): string[] {
  const entries = db
    .prepare(
      `SELECT entry_id FROM design_system_entries
       WHERE section = 'components.inventory'
       ORDER BY entry_id ASC`
    )
    .all() as Array<{ entry_id: string }>;
  return entries.map((entry) => `component:${entry.entry_id}`);
}

function progressiveClaimShapeFailure(
  claims: DesignSystemExtractionWorkUnitClaimInput[]
): ProgressiveExtractionFailure | null {
  if (!Array.isArray(claims) || claims.length === 0) {
    return { ok: false, reason: "invalid_work_unit" };
  }
  const seen = new Set<string>();
  for (const claim of claims) {
    if (
      "section" in claim ||
      !nonEmptyString(claim.claimId) ||
      !nonEmptyString(claim.statement) ||
      !stringArray(claim.sourceRecordIds) ||
      claim.sourceRecordIds.length === 0 ||
      !stringArray(claim.sourceExcerpts) ||
      claim.sourceExcerpts.length === 0 ||
      (claim.confidence !== "confirmed" && claim.confidence !== "reasonable") ||
      !["mapped", "conflict", "omitted", "gap"].includes(claim.outcome) ||
      !Array.isArray(claim.targets)
    ) {
      return { ok: false, reason: "invalid_work_unit" };
    }
    if (seen.has(claim.claimId)) {
      return {
        ok: false,
        reason: "duplicate_claim_id",
        details: { claim_id: claim.claimId }
      };
    }
    seen.add(claim.claimId);
    const needsTarget = claim.outcome === "mapped" || claim.outcome === "gap";
    if (needsTarget && claim.targets.length === 0) {
      return { ok: false, reason: "invalid_work_unit" };
    }
    if (
      (claim.outcome === "omitted" || claim.outcome === "conflict") &&
      !nonEmptyString(claim.reason)
    ) {
      return { ok: false, reason: "invalid_work_unit" };
    }
    for (const target of claim.targets) {
      if (
        "jsonPointer" in target ||
        !nonEmptyString(target.artifactPath) ||
        !nonEmptyString(target.entryId) ||
        (target.fieldPath !== undefined &&
          (!Array.isArray(target.fieldPath) ||
            target.fieldPath.some((segment) => !nonEmptyString(segment))))
      ) {
        return { ok: false, reason: "invalid_work_unit" };
      }
    }
  }
  return null;
}

function resolveProgressiveWorkUnit(
  entries: DesignSystemEntryKeyRow[],
  stored: StoredDesignSystemExtractionWorkUnit
):
  | {
      ok: true;
      workUnit: DesignSystemExtractionWorkUnitRecord;
    }
  | ProgressiveExtractionFailure {
  const entriesByKey = new Map(
    entries.map((entry) => [entryKey(entry.source_artifact_path, entry.entry_id), entry])
  );
  const claims: DesignSystemExtractionWorkUnitClaim[] = [];
  for (const claim of stored.claims) {
    const targets: DesignSystemExtractionWorkUnitTarget[] = [];
    for (const target of claim.targets) {
      const entry = entriesByKey.get(entryKey(target.artifactPath, target.entryId));
      if (!entry) {
        return {
          ok: false,
          reason: "manifest_target_not_found",
          details: {
            claim_id: claim.claimId,
            artifact_path: target.artifactPath,
            entry_id: target.entryId
          }
        };
      }
      if (target.fieldPath && target.fieldPath.length > 0) {
        let current: unknown = {
          value: JSON.parse(entry.value_json) as unknown,
          status: entry.status,
          links: JSON.parse(entry.links_json) as unknown
        };
        for (const segment of target.fieldPath) {
          if (
            !isRecord(current) ||
            !Object.prototype.hasOwnProperty.call(current, segment)
          ) {
            return {
              ok: false,
              reason: "manifest_target_field_not_found",
              details: {
                claim_id: claim.claimId,
                artifact_path: target.artifactPath,
                entry_id: target.entryId,
                field_path: target.fieldPath
              }
            };
          }
          current = current[segment];
        }
      }
      const fieldSuffix = (target.fieldPath ?? [])
        .map((segment) => `/${jsonPointerSegment(segment)}`)
        .join("");
      targets.push({
        ...target,
        jsonPointer: `${expectedJsonPointer(entry)}${fieldSuffix}`
      });
    }
    claims.push({ ...claim, targets });
  }
  return {
    ok: true,
    workUnit: {
      key: stored.key,
      kind: stored.kind,
      definition: stored.definition,
      claims,
      version: stored.version,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt
    }
  };
}

function progressiveExtractionStateOnDb(
  db: DatabaseType,
  frozenInput: FrozenInitialDesignSystemInput,
  alignmentAttemptId: string
): {
  workUnits: DesignSystemExtractionWorkUnitRecoveryRecord[];
  residualClaims: DesignSystemExtractionWorkUnitClaimInput[];
  audit: DesignSystemExtractionAudit | null;
  progress: DesignSystemExtractionProgress;
} {
  const row = db
    .prepare(
      `SELECT * FROM design_system_extraction_manifests
       WHERE alignment_attempt_id = ?`
    )
    .get(alignmentAttemptId) as Record<string, unknown> | undefined;
  const manifest = progressiveManifestFromRow(row);
  const entries = db
    .prepare(
      `SELECT source_artifact_path, entry_id, section, name, kind, domain,
              status, links_json, value_json, position
       FROM design_system_entries`
    )
    .all() as unknown as DesignSystemEntryKeyRow[];
  const workUnits = manifest.workUnits.map((stored) => {
    const resolved = resolveProgressiveWorkUnit(entries, stored);
    if (!resolved.ok) {
      return {
        ...stored,
        resolutionError: {
          reason:
            resolved.reason === "manifest_target_field_not_found"
              ? "manifest_target_field_not_found"
              : "manifest_target_not_found",
          ...(resolved.details ? { details: resolved.details } : {})
        }
      } satisfies DesignSystemExtractionWorkUnitRecoveryRecord;
    }
    return resolved.workUnit;
  });
  const progress = progressiveExtractionProgress(
    frozenInput,
    manifest,
    componentWorkUnitKeys(entries)
  );
  const hasResolutionError = workUnits.some(
    (workUnit) => "resolutionError" in workUnit
  );
  return {
    workUnits,
    residualClaims: manifest.residualClaims,
    audit: manifest.audit,
    progress: hasResolutionError
      ? { ...progress, readyToFinalize: false }
      : progress
  };
}

/**
 * Record or replace one progressive output work unit after its artifacts have
 * been declared and ingested. Evidence may span Alignment sections; the
 * Runtime derives source placement from record ids and output placement from
 * stable artifact/entry identities.
 */
export function recordDesignSystemExtractionWorkUnit(
  projectPath: string,
  rawInput: RecordDesignSystemExtractionWorkUnitInput
):
  | {
      ok: true;
      reused: boolean;
      retired?: false;
      work_unit: DesignSystemExtractionWorkUnitRecord;
      progress: DesignSystemExtractionProgress;
      event_id: string | null;
    }
  | {
      ok: true;
      reused: boolean;
      retired: true;
      work_unit_key: string;
      progress: DesignSystemExtractionProgress;
      event_id: string | null;
    }
  | ProgressiveExtractionFailure {
  if (
    !isRecord(rawInput) ||
    !nonEmptyString(rawInput.alignmentAttemptId) ||
    !nonEmptyString(rawInput.idempotencyKey) ||
    !isRecord(rawInput.workUnit) ||
    !(DESIGN_SYSTEM_EXTRACTION_WORK_UNIT_KINDS as readonly string[]).includes(
      String(rawInput.workUnit.kind)
    )
  ) {
    return { ok: false, reason: "invalid_work_unit" };
  }
  const input = rawInput;
  const definition = input.workUnit;
  if (
    definition.kind === "component" &&
    !nonEmptyString(definition.componentEntryId)
  ) {
    return { ok: false, reason: "invalid_work_unit" };
  }
  const retiring =
    definition.kind === "component" && definition.retire === true;
  if (
    retiring
      ? !Array.isArray(input.claims) ||
        input.claims.length !== 0 ||
        definition.specArtifactPath !== undefined
      : progressiveClaimShapeFailure(input.claims) !== null
  ) {
    return { ok: false, reason: "invalid_work_unit" };
  }
  const workUnitKey = extractionWorkUnitKey(definition);
  const requestJson = JSON.stringify({
    type: "work-unit",
    workUnitKey,
    definition,
    claims: input.claims
  });

  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const state = getAlignmentPreparationOnDb(db);
      const attempt = state.current_attempt;
      const command = state.commands.find(
        (candidate) => candidate.command_type === "prepare_initial_design_system"
      );
      if (!attempt || attempt.id !== input.alignmentAttemptId || !command) {
        return { ok: false, reason: "stale_alignment_attempt" } as const;
      }
      if (command.status !== "claimed") {
        return {
          ok: false,
          reason: "initial_design_system_command_not_claimed"
        } as const;
      }
      const frozenInput = ensureFrozenInputOnDb(db, state, command);
      const existingRow = db
        .prepare(
          `SELECT * FROM design_system_extraction_manifests
           WHERE alignment_attempt_id = ?`
        )
        .get(input.alignmentAttemptId) as Record<string, unknown> | undefined;
      const manifest = progressiveManifestFromRow(existingRow);
      const priorRequest = db
        .prepare(
          `SELECT manifest_json FROM design_system_extraction_manifest_requests
           WHERE alignment_attempt_id = ? AND idempotency_key = ?`
        )
        .get(input.alignmentAttemptId, input.idempotencyKey) as
        | { manifest_json: string }
        | undefined;
      if (priorRequest) {
        const recordedRequest = JSON.parse(priorRequest.manifest_json) as {
          request?: unknown;
          workUnit?: StoredDesignSystemExtractionWorkUnit;
          retiredWorkUnitKey?: string;
        };
        if (recordedRequest.request !== requestJson) {
          return { ok: false, reason: "idempotency_conflict" } as const;
        }
        const entries = db
          .prepare(
            `SELECT source_artifact_path, entry_id, section, name, kind, domain,
                    status, links_json, value_json, position
             FROM design_system_entries`
          )
          .all() as unknown as DesignSystemEntryKeyRow[];
        if (recordedRequest.retiredWorkUnitKey) {
          return {
            ok: true as const,
            reused: true,
            retired: true as const,
            work_unit_key: recordedRequest.retiredWorkUnitKey,
            progress: progressiveExtractionProgress(
              frozenInput,
              manifest,
              componentWorkUnitKeys(entries)
            ),
            event_id: null
          };
        }
        const stored = recordedRequest.workUnit;
        if (!stored) return { ok: false, reason: "db_error" } as const;
        const resolved = resolveProgressiveWorkUnit(entries, stored);
        if (!resolved.ok) return resolved;
        return {
          ok: true as const,
          reused: true,
          work_unit: resolved.workUnit,
          progress: progressiveExtractionProgress(
            frozenInput,
            manifest,
            componentWorkUnitKeys(entries)
          ),
          event_id: null
        };
      }

      if (retiring) {
        const previous = manifest.workUnits.find(
          (unit) => unit.key === workUnitKey
        );
        if (!previous || !existingRow) {
          return {
            ok: false,
            reason: "component_work_unit_mismatch",
            details: {
              component_entry_id: definition.componentEntryId,
              problem: "work_unit_not_found"
            }
          } as const;
        }
        const now = new Date().toISOString();
        const retiredSpecArtifactPath =
          previous.definition.kind === "component"
            ? previous.definition.specArtifactPath
            : undefined;
        const specStillOwned =
          retiredSpecArtifactPath !== undefined &&
          manifest.workUnits.some(
            (unit) =>
              unit.key !== workUnitKey &&
              unit.definition.kind === "component" &&
              unit.definition.specArtifactPath === retiredSpecArtifactPath
          );
        manifest.workUnits = manifest.workUnits.filter(
          (unit) => unit.key !== workUnitKey
        );
        manifest.residualClaims = [];
        manifest.audit = null;
        if (retiredSpecArtifactPath && !specStillOwned) {
          db.prepare(
            "DELETE FROM design_system_entries WHERE source_artifact_path = ?"
          ).run(retiredSpecArtifactPath);
          db.prepare(
            `DELETE FROM source_artifacts
             WHERE path = ? AND artifact_type = 'component-spec'`
          ).run(retiredSpecArtifactPath);
        }
        const id = String(existingRow.id);
        const aggregateVersion = Number(existingRow.version) + 1;
        const manifestJson = JSON.stringify(manifest);
        db.prepare(
          `UPDATE design_system_extraction_manifests
           SET idempotency_key = ?, manifest_json = ?, version = ?, updated_at = ?
           WHERE id = ?`
        ).run(input.idempotencyKey, manifestJson, aggregateVersion, now, id);
        db.prepare(
          `INSERT INTO design_system_extraction_manifest_requests
           (alignment_attempt_id, idempotency_key, manifest_id, agent_command_id,
            manifest_json, manifest_version, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          input.alignmentAttemptId,
          input.idempotencyKey,
          id,
          command.id,
          JSON.stringify({ request: requestJson, retiredWorkUnitKey: workUnitKey }),
          aggregateVersion,
          now
        );
        const event = logEventOnDb(
          db,
          "design_system_extraction_work_unit_recorded",
          {
            alignment_attempt_id: input.alignmentAttemptId,
            agent_command_id: command.id,
            manifest_id: id,
            manifest_version: aggregateVersion,
            work_unit_key: workUnitKey,
            action: "retired",
            retired_spec_artifact_path: retiredSpecArtifactPath ?? null,
            claim_count: 0
          }
        );
        const entries = db
          .prepare(
            `SELECT source_artifact_path, entry_id, section, name, kind, domain,
                    status, links_json, value_json, position
             FROM design_system_entries`
          )
          .all() as unknown as DesignSystemEntryKeyRow[];
        return {
          ok: true as const,
          reused: false,
          retired: true as const,
          work_unit_key: workUnitKey,
          progress: progressiveExtractionProgress(
            frozenInput,
            manifest,
            componentWorkUnitKeys(entries)
          ),
          event_id: event.event_id
        };
      }

      const sourceConfidence = new Map<string, "confirmed" | "reasonable">([
        ...frozenInput.question_cards.map((card) => [card.id, "confirmed"] as const),
        ...frozenInput.annotations.map(
          (annotation) => [annotation.id, annotation.inference] as const
        ),
        ...frozenInput.designer_annotations.map(
          (annotation) => [annotation.id, "confirmed"] as const
        )
      ]);
      for (const claim of input.claims) {
        for (const sourceId of claim.sourceRecordIds) {
          if (!sourceConfidence.has(sourceId)) {
            return {
              ok: false,
              reason: "invalid_manifest_source",
              details: { claim_id: claim.claimId, source_record_id: sourceId }
            } as const;
          }
        }
        if (
          claim.confidence === "confirmed" &&
          claim.sourceRecordIds.some(
            (sourceId) => sourceConfidence.get(sourceId) !== "confirmed"
          )
        ) {
          return {
            ok: false,
            reason: "claim_confidence_exceeds_source",
            details: { claim_id: claim.claimId }
          } as const;
        }
      }

      const otherClaimIds = new Set(
        manifest.workUnits
          .filter((unit) => unit.key !== workUnitKey)
          .flatMap((unit) => unit.claims.map((claim) => claim.claimId))
          .concat(manifest.residualClaims.map((claim) => claim.claimId))
      );
      const duplicate = input.claims.find((claim) => otherClaimIds.has(claim.claimId));
      if (duplicate) {
        return {
          ok: false,
          reason: "duplicate_claim_id",
          details: { claim_id: duplicate.claimId }
        } as const;
      }

      const allowedArtifacts = new Set(workUnitArtifactPaths(definition));
      const outOfScope = input.claims
        .flatMap((claim) => claim.targets.map((target) => ({ claim, target })))
        .find(({ target }) => !allowedArtifacts.has(target.artifactPath));
      if (outOfScope) {
        return {
          ok: false,
          reason: "work_unit_target_out_of_scope",
          details: {
            claim_id: outOfScope.claim.claimId,
            artifact_path: outOfScope.target.artifactPath,
            work_unit_key: workUnitKey
          }
        } as const;
      }
      const invalidFieldTarget = input.claims
        .flatMap((claim) =>
          claim.targets.map((target) => ({ claim, target }))
        )
        .find(
          ({ claim, target }) =>
            target.fieldPath !== undefined &&
            (definition.kind !== "component" ||
              claim.outcome !== "omitted" ||
              target.artifactPath !== definition.specArtifactPath ||
              target.fieldPath.length !== 2 ||
              target.fieldPath[0] !== "value" ||
              !(RICH_COMPONENT_SPEC_FIELDS as readonly string[]).includes(
                target.fieldPath[1] ?? ""
              ))
        );
      if (invalidFieldTarget) {
        return {
          ok: false,
          reason: "invalid_work_unit",
          details: {
            claim_id: invalidFieldTarget.claim.claimId,
            field_path: invalidFieldTarget.target.fieldPath,
            expected:
              "omitted component-spec target with fieldPath ['value', <component field>]"
          }
        } as const;
      }
      const artifactRows = db
        .prepare("SELECT path, status FROM source_artifacts")
        .all() as Array<{ path: string; status: string }>;
      const artifacts = new Map(artifactRows.map((row) => [row.path, row.status]));
      const missingArtifact = [...allowedArtifacts].find(
        (artifactPath) => artifacts.get(artifactPath) !== "ingested"
      );
      if (missingArtifact) {
        return {
          ok: false,
          reason: "work_unit_artifact_not_ingested",
          details: { artifact_path: missingArtifact, work_unit_key: workUnitKey }
        } as const;
      }

      const entries = db
        .prepare(
          `SELECT source_artifact_path, entry_id, section, name, kind, domain,
                  status, links_json, value_json, position
           FROM design_system_entries`
        )
        .all() as unknown as DesignSystemEntryKeyRow[];
      if (definition.kind === "component") {
        const inventoryEntry = entries.find(
          (entry) =>
            entry.source_artifact_path === "design-system/component-list.json" &&
            entry.section === "components.inventory" &&
            entry.entry_id === definition.componentEntryId
        );
        if (!inventoryEntry) {
          return {
            ok: false,
            reason: "component_work_unit_mismatch",
            details: {
              component_entry_id: definition.componentEntryId,
              problem: "inventory_entry_not_found"
            }
          } as const;
        }
        const inventoryValue = JSON.parse(inventoryEntry.value_json) as {
          specPath?: unknown;
        };
        const declaredSpecPath =
          typeof inventoryValue.specPath === "string"
            ? inventoryValue.specPath
            : "";
        const specEntries = definition.specArtifactPath
          ? entries.filter(
              (entry) =>
                entry.source_artifact_path === definition.specArtifactPath &&
                entry.section === "components.spec"
            )
          : [];
        if (
          inventoryEntry.status !== "gap" &&
          (!definition.specArtifactPath ||
            !specPathMatchesSourceArtifact(
              declaredSpecPath,
              definition.specArtifactPath
            ) ||
            specEntries.length !== 1)
        ) {
          return {
            ok: false,
            reason: "component_work_unit_mismatch",
            details: {
              component_entry_id: definition.componentEntryId,
              spec_path: declaredSpecPath,
              spec_artifact_path: definition.specArtifactPath ?? null,
              problem: "inventory_spec_pair_missing"
            }
          } as const;
        }
        const missingCaptures = missingComponentCaptures(
          projectPath,
          specEntries
        );
        if (missingCaptures.length > 0) {
          return {
            ok: false,
            reason: "component_capture_missing",
            details: { captures: missingCaptures }
          } as const;
        }
        const foreignTarget = input.claims
          .flatMap((claim) =>
            claim.targets.map((target) => ({ claimId: claim.claimId, target }))
          )
          .find(({ target }) => {
            if (target.artifactPath === "design-system/component-list.json") {
              return target.entryId !== definition.componentEntryId;
            }
            if (target.artifactPath === definition.specArtifactPath) {
              return !specEntries.some(
                (entry) => entry.entry_id === target.entryId
              );
            }
            return false;
          });
        if (foreignTarget) {
          return {
            ok: false,
            reason: "component_work_unit_mismatch",
            details: {
              component_entry_id: definition.componentEntryId,
              claim_id: foreignTarget.claimId,
              artifact_path: foreignTarget.target.artifactPath,
              entry_id: foreignTarget.target.entryId,
              problem: "target_owned_by_another_component"
            }
          } as const;
        }
        const targetedKeys = new Set(
          input.claims.flatMap((claim) =>
            claim.targets.map((target) =>
              entryKey(target.artifactPath, target.entryId)
            )
          )
        );
        const inventoryTargeted = targetedKeys.has(
          entryKey(
            "design-system/component-list.json",
            definition.componentEntryId
          )
        );
        const specTargeted =
          inventoryEntry.status === "gap" ||
          specEntries.some((entry) =>
            targetedKeys.has(
              entryKey(entry.source_artifact_path, entry.entry_id)
            )
          );
        if (!inventoryTargeted || !specTargeted) {
          return {
            ok: false,
            reason: "component_work_unit_mismatch",
            details: {
              component_entry_id: definition.componentEntryId,
              problem: "inventory_and_spec_must_be_targeted"
            }
          } as const;
        }
      }
      const now = new Date().toISOString();
      const previous = manifest.workUnits.find((unit) => unit.key === workUnitKey);
      const stored: StoredDesignSystemExtractionWorkUnit = {
        key: workUnitKey,
        kind: definition.kind,
        definition,
        claims: input.claims,
        version: (previous?.version ?? 0) + 1,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now
      };
      const resolved = resolveProgressiveWorkUnit(entries, stored);
      if (!resolved.ok) return resolved;

      manifest.workUnits = [
        ...manifest.workUnits.filter((unit) => unit.key !== workUnitKey),
        stored
      ];
      manifest.residualClaims = [];
      manifest.audit = null;
      const id = existingRow ? String(existingRow.id) : randomUUID();
      const aggregateVersion = existingRow ? Number(existingRow.version) + 1 : 1;
      const manifestJson = JSON.stringify(manifest);
      if (existingRow) {
        db.prepare(
          `UPDATE design_system_extraction_manifests
           SET idempotency_key = ?, manifest_json = ?, version = ?, updated_at = ?
           WHERE id = ?`
        ).run(input.idempotencyKey, manifestJson, aggregateVersion, now, id);
      } else {
        db.prepare(
          `INSERT INTO design_system_extraction_manifests
           (id, alignment_attempt_id, agent_command_id, idempotency_key,
            manifest_json, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          input.alignmentAttemptId,
          command.id,
          input.idempotencyKey,
          manifestJson,
          aggregateVersion,
          now,
          now
        );
      }
      db.prepare(
        `INSERT INTO design_system_extraction_manifest_requests
         (alignment_attempt_id, idempotency_key, manifest_id, agent_command_id,
          manifest_json, manifest_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        input.alignmentAttemptId,
        input.idempotencyKey,
        id,
        command.id,
        JSON.stringify({ request: requestJson, workUnit: stored }),
        aggregateVersion,
        now
      );
      const event = logEventOnDb(db, "design_system_extraction_work_unit_recorded", {
        alignment_attempt_id: input.alignmentAttemptId,
        agent_command_id: command.id,
        manifest_id: id,
        manifest_version: aggregateVersion,
        work_unit_key: workUnitKey,
        work_unit_version: stored.version,
        claim_count: stored.claims.length
      });
      return {
        ok: true as const,
        reused: false,
        work_unit: resolved.workUnit,
        progress: progressiveExtractionProgress(
          frozenInput,
          manifest,
          componentWorkUnitKeys(entries)
        ),
        event_id: event.event_id
      };
    });

    if (result.ok && !result.reused) {
      emitRecordEvent({
        kind: "design-system",
        action: result.retired ? "deleted" : "updated",
        id: result.retired ? result.work_unit_key : result.work_unit.key,
        projectPath: path.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

/** Record the final residual classifications and global extraction audit. */
export function recordDesignSystemExtractionAudit(
  projectPath: string,
  rawInput: RecordDesignSystemExtractionAuditInput
):
  | {
      ok: true;
      reused: boolean;
      audit: DesignSystemExtractionAudit;
      residual_claims: DesignSystemExtractionWorkUnitClaimInput[];
      progress: DesignSystemExtractionProgress;
      event_id: string | null;
    }
  | ProgressiveExtractionFailure {
  if (
    !isRecord(rawInput) ||
    !nonEmptyString(rawInput.alignmentAttemptId) ||
    !nonEmptyString(rawInput.idempotencyKey) ||
    !Array.isArray(rawInput.residualClaims) ||
    !isRecord(rawInput.audit) ||
    (rawInput.audit.status !== "passed" && rawInput.audit.status !== "failed") ||
    !stringArray(rawInput.audit.checkedClaimIds) ||
    !stringArray(rawInput.audit.issues, true)
  ) {
    return { ok: false, reason: "invalid_audit" };
  }
  if (rawInput.residualClaims.length > 0) {
    const shapeFailure = progressiveClaimShapeFailure(rawInput.residualClaims);
    if (shapeFailure) return shapeFailure;
  }
  const invalidResidual = rawInput.residualClaims.find(
    (claim) =>
      (claim.outcome !== "omitted" && claim.outcome !== "conflict") ||
      claim.targets.length > 0
  );
  if (invalidResidual) {
    return {
      ok: false,
      reason: "invalid_audit",
      details: { claim_id: invalidResidual.claimId }
    };
  }
  const input = rawInput;
  const requestJson = JSON.stringify({
    type: "audit",
    residualClaims: input.residualClaims,
    audit: input.audit
  });

  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const state = getAlignmentPreparationOnDb(db);
      const attempt = state.current_attempt;
      const command = state.commands.find(
        (candidate) => candidate.command_type === "prepare_initial_design_system"
      );
      if (!attempt || attempt.id !== input.alignmentAttemptId || !command) {
        return { ok: false, reason: "stale_alignment_attempt" } as const;
      }
      if (command.status !== "claimed") {
        return {
          ok: false,
          reason: "initial_design_system_command_not_claimed"
        } as const;
      }
      const frozenInput = ensureFrozenInputOnDb(db, state, command);
      const existingRow = db
        .prepare(
          `SELECT * FROM design_system_extraction_manifests
           WHERE alignment_attempt_id = ?`
        )
        .get(input.alignmentAttemptId) as Record<string, unknown> | undefined;
      if (!existingRow) {
        return { ok: false, reason: "invalid_audit" } as const;
      }
      const manifest = progressiveManifestFromRow(existingRow);
      const priorRequest = db
        .prepare(
          `SELECT manifest_json FROM design_system_extraction_manifest_requests
           WHERE alignment_attempt_id = ? AND idempotency_key = ?`
        )
        .get(input.alignmentAttemptId, input.idempotencyKey) as
        | { manifest_json: string }
        | undefined;
      if (priorRequest) {
        const recorded = JSON.parse(priorRequest.manifest_json) as {
          request?: unknown;
        };
        if (recorded.request !== requestJson) {
          return { ok: false, reason: "idempotency_conflict" } as const;
        }
        return {
          ok: true as const,
          reused: true,
          audit: manifest.audit ?? input.audit,
          residual_claims: manifest.residualClaims,
          progress: progressiveExtractionProgress(
            frozenInput,
            manifest,
            componentWorkUnitKeysOnDb(db)
          ),
          event_id: null
        };
      }

      const existingClaimIds = new Set(
        manifest.workUnits.flatMap((unit) =>
          unit.claims.map((claim) => claim.claimId)
        )
      );
      const duplicate = input.residualClaims.find((claim) =>
        existingClaimIds.has(claim.claimId)
      );
      if (duplicate) {
        return {
          ok: false,
          reason: "duplicate_claim_id",
          details: { claim_id: duplicate.claimId }
        } as const;
      }
      const sourceConfidence = new Map<string, "confirmed" | "reasonable">([
        ...frozenInput.question_cards.map((card) => [card.id, "confirmed"] as const),
        ...frozenInput.annotations.map(
          (annotation) => [annotation.id, annotation.inference] as const
        ),
        ...frozenInput.designer_annotations.map(
          (annotation) => [annotation.id, "confirmed"] as const
        )
      ]);
      for (const claim of input.residualClaims) {
        for (const sourceId of claim.sourceRecordIds) {
          if (!sourceConfidence.has(sourceId)) {
            return {
              ok: false,
              reason: "invalid_manifest_source",
              details: { claim_id: claim.claimId, source_record_id: sourceId }
            } as const;
          }
        }
        if (
          claim.confidence === "confirmed" &&
          claim.sourceRecordIds.some(
            (sourceId) => sourceConfidence.get(sourceId) !== "confirmed"
          )
        ) {
          return {
            ok: false,
            reason: "claim_confidence_exceeds_source",
            details: { claim_id: claim.claimId }
          } as const;
        }
      }

      const candidateManifest: ProgressiveDesignSystemExtractionManifest = {
        ...manifest,
        residualClaims: input.residualClaims,
        audit: input.audit
      };
      const progress = progressiveExtractionProgress(
        frozenInput,
        candidateManifest,
        componentWorkUnitKeysOnDb(db)
      );
      if (
        progress.remainingQuestionCardIds.length > 0 ||
        progress.remainingAgentAnnotationIds.length > 0 ||
        progress.remainingDesignerAnnotationIds.length > 0
      ) {
        return {
          ok: false,
          reason: "input_coverage_incomplete",
          details: {
            missing_question_card_ids: progress.remainingQuestionCardIds,
            missing_agent_annotation_ids: progress.remainingAgentAnnotationIds,
            missing_designer_annotation_ids:
              progress.remainingDesignerAnnotationIds
          }
        } as const;
      }
      const allClaimIds = new Set([
        ...existingClaimIds,
        ...input.residualClaims.map((claim) => claim.claimId)
      ]);
      const checked = new Set(input.audit.checkedClaimIds);
      const missingClaimIds = [...allClaimIds].filter(
        (claimId) => !checked.has(claimId)
      );
      const unknownClaimIds = [...checked].filter(
        (claimId) => !allClaimIds.has(claimId)
      );
      if (missingClaimIds.length > 0 || unknownClaimIds.length > 0) {
        return {
          ok: false,
          reason: "manifest_audit_incomplete",
          details: {
            missing_claim_ids: missingClaimIds,
            unknown_claim_ids: unknownClaimIds
          }
        } as const;
      }

      const now = new Date().toISOString();
      const aggregateVersion = Number(existingRow.version) + 1;
      db.prepare(
        `UPDATE design_system_extraction_manifests
         SET idempotency_key = ?, manifest_json = ?, version = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        input.idempotencyKey,
        JSON.stringify(candidateManifest),
        aggregateVersion,
        now,
        String(existingRow.id)
      );
      db.prepare(
        `INSERT INTO design_system_extraction_manifest_requests
         (alignment_attempt_id, idempotency_key, manifest_id, agent_command_id,
          manifest_json, manifest_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        input.alignmentAttemptId,
        input.idempotencyKey,
        String(existingRow.id),
        command.id,
        JSON.stringify({ request: requestJson }),
        aggregateVersion,
        now
      );
      const event = logEventOnDb(db, "design_system_extraction_audit_recorded", {
        alignment_attempt_id: input.alignmentAttemptId,
        agent_command_id: command.id,
        manifest_id: String(existingRow.id),
        manifest_version: aggregateVersion,
        residual_claim_count: input.residualClaims.length,
        audit_status: input.audit.status
      });
      return {
        ok: true as const,
        reused: false,
        audit: input.audit,
        residual_claims: input.residualClaims,
        progress,
        event_id: event.event_id
      };
    });
    if (result.ok && !result.reused) {
      emitRecordEvent({
        kind: "design-system",
        action: "updated",
        id: input.alignmentAttemptId,
        projectPath: path.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

type FinalizeInitialDesignSystemFailure = {
  ok: false;
  reason:
    | "stale_alignment_attempt"
    | "initial_design_system_command_not_claimed"
    | "extraction_work_units_incomplete"
    | "extraction_audit_required"
    | "extraction_audit_failed"
    | "manifest_conflicts_unresolved"
    | "required_artifacts_missing"
    | "manifest_target_not_found"
    | "manifest_target_field_not_found"
    | "manifest_outcome_status_mismatch"
    | "entry_claim_lineage_mismatch"
    | "uncovered_design_system_entries"
    | "entry_kind_missing"
    | "token_domain_missing"
    | "required_artifacts_not_ingested"
    | "component_specs_missing"
    | "component_capture_missing"
    | "component_spec_fields_missing"
    | "formalized_claim_support_insufficient"
    | "db_error";
  details?: Record<string, unknown>;
};

type DesignSystemEntryKeyRow = {
  source_artifact_path: string;
  entry_id: string;
  section: string;
  name: string | null;
  kind: string | null;
  domain: string | null;
  status: string;
  links_json: string;
  value_json: string;
  position: number;
};

function entryKey(sourceArtifactPath: string, entryId: string): string {
  return `${sourceArtifactPath}\u0000${entryId}`;
}

function jsonPointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function expectedJsonPointer(entry: DesignSystemEntryKeyRow): string {
  if (entry.section === "foundations.visual-language") {
    return "/visualLanguage";
  }
  if (entry.section === "foundations.principles") {
    return `/principles/${entry.position}`;
  }
  if (entry.section.startsWith("token.")) {
    const layer = entry.section.slice("token.".length);
    const name =
      entry.name ??
      entry.entry_id.slice(entry.entry_id.indexOf(".") + 1);
    return `/${jsonPointerSegment(layer)}/${jsonPointerSegment(name)}`;
  }
  if (entry.section === "components.inventory") {
    return `/components/${entry.position}`;
  }
  if (entry.section === "components.spec") return "";
  if (entry.section === "layout" || entry.section === "interaction") {
    return `/rules/${entry.position}`;
  }
  return "/";
}

function finalizeFailure(
  db: DatabaseType,
  reason: FinalizeInitialDesignSystemFailure["reason"],
  details: Record<string, unknown> | undefined,
  context: { attemptId: string; commandId: string }
): FinalizeInitialDesignSystemFailure {
  logEventOnDb(db, "design_system_extraction_coverage_rejected", {
    alignment_attempt_id: context.attemptId,
    agent_command_id: context.commandId,
    reason,
    ...(details ? { details } : {})
  });
  logEventOnDb(db, "initial_design_system_preparation_failed", {
    alignment_attempt_id: context.attemptId,
    agent_command_id: context.commandId,
    reason
  });
  return details === undefined
    ? { ok: false, reason }
    : { ok: false, reason, details };
}

export function finalizeInitialDesignSystemPreparation(
  projectPath: string,
  alignmentAttemptId: string
) {
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const state = getAlignmentPreparationOnDb(db);
      const attempt = state.current_attempt;
      const command = state.commands.find(
        (candidate) =>
          candidate.command_type === "prepare_initial_design_system"
      );
      if (!attempt || attempt.id !== alignmentAttemptId || !command) {
        return {
          ok: false,
          reason: "stale_alignment_attempt"
        } as FinalizeInitialDesignSystemFailure;
      }

      const manifestRow = db
        .prepare(
          `SELECT * FROM design_system_extraction_manifests
           WHERE alignment_attempt_id = ?`
        )
        .get(alignmentAttemptId) as Record<string, unknown> | undefined;

      if (command.status === "completed") {
        if (!manifestRow) {
          return {
            ok: false,
            reason: "extraction_work_units_incomplete"
          } as FinalizeInitialDesignSystemFailure;
        }
        const progressive = progressiveExtractionStateOnDb(
          db,
          ensureFrozenInputOnDb(db, state, command),
          alignmentAttemptId
        );
        return {
          ok: true as const,
          reused: true,
          workflow: state.workflow,
          attempt,
          command,
          extraction_work_units: progressive.workUnits,
          extraction_audit: progressive.audit,
          extraction_progress: progressive.progress,
          event_id: null
        };
      }
      if (
        state.workflow.stage !== "initial-design-system-preparing" ||
        attempt.status !== "completed"
      ) {
        return {
          ok: false,
          reason: "stale_alignment_attempt"
        } as FinalizeInitialDesignSystemFailure;
      }
      if (command.status !== "claimed") {
        return {
          ok: false,
          reason: "initial_design_system_command_not_claimed"
        } as FinalizeInitialDesignSystemFailure;
      }
      const frozenInput = ensureFrozenInputOnDb(db, state, command);

      const context = { attemptId: attempt.id, commandId: command.id };
      if (!manifestRow) {
        return finalizeFailure(
          db,
          "extraction_work_units_incomplete",
          undefined,
          context
        );
      }
      const manifest = progressiveManifestFromRow(manifestRow);
      const progress = progressiveExtractionProgress(
        frozenInput,
        manifest,
        componentWorkUnitKeysOnDb(db)
      );
      const requiredWorkUnitKeys = ["global", "tokens", "layout", "interaction"];
      const missingWorkUnitKeys = requiredWorkUnitKeys.filter(
        (key) => !progress.completedWorkUnitKeys.includes(key)
      );
      if (missingWorkUnitKeys.length > 0) {
        return finalizeFailure(
          db,
          "extraction_work_units_incomplete",
          { missing_work_unit_keys: missingWorkUnitKeys },
          context
        );
      }
      if (!manifest.audit) {
        return finalizeFailure(db, "extraction_audit_required", undefined, context);
      }
      if (
        manifest.audit.status !== "passed" ||
        manifest.audit.issues.length > 0
      ) {
        return finalizeFailure(
          db,
          "extraction_audit_failed",
          { issues: manifest.audit.issues },
          context
        );
      }
      const claims = [
        ...manifest.workUnits.flatMap((workUnit) => workUnit.claims),
        ...manifest.residualClaims
      ];
      const conflicts = claims
        .filter((claim) => claim.outcome === "conflict")
        .map((claim) => claim.claimId);
      if (conflicts.length > 0) {
        return finalizeFailure(
          db,
          "manifest_conflicts_unresolved",
          { claim_ids: conflicts },
          context
        );
      }

      const artifactRows = db
        .prepare("SELECT path, artifact_type, status FROM source_artifacts")
        .all() as Array<{
          path: string;
          artifact_type: string;
          status: string;
        }>;
      const artifactsByPath = new Map(
        artifactRows.map((row) => [row.path, row])
      );
      const missingArtifactPaths =
        INITIAL_DESIGN_SYSTEM_REQUIRED_ARTIFACTS.filter(
          (artifactPath) => !artifactsByPath.has(artifactPath)
        );
      if (missingArtifactPaths.length > 0) {
        return finalizeFailure(
          db,
          "required_artifacts_missing",
          { missing_artifact_paths: missingArtifactPaths },
          context
        );
      }
      const notIngestedArtifacts =
        INITIAL_DESIGN_SYSTEM_REQUIRED_ARTIFACTS.flatMap((artifactPath) => {
          const artifact = artifactsByPath.get(artifactPath)!;
          const expectedType = REQUIRED_ARTIFACT_TYPES[artifactPath];
          return artifact.status === "ingested" &&
            artifact.artifact_type === expectedType
            ? []
            : [
                {
                  artifact_path: artifactPath,
                  artifact_type: artifact.artifact_type,
                  expected_artifact_type: expectedType,
                  status: artifact.status
                }
              ];
        });
      if (notIngestedArtifacts.length > 0) {
        return finalizeFailure(
          db,
          "required_artifacts_not_ingested",
          { artifacts: notIngestedArtifacts },
          context
        );
      }

      const entries = db
        .prepare(
          `SELECT source_artifact_path, entry_id, section, name, kind, domain,
                  status, links_json, value_json, position
           FROM design_system_entries
           ORDER BY source_artifact_path ASC, entry_id ASC`
        )
        .all() as unknown as DesignSystemEntryKeyRow[];
      const entriesByKey = new Map(
        entries.map((entry) => [
          entryKey(entry.source_artifact_path, entry.entry_id),
          entry
        ])
      );
      for (const workUnit of manifest.workUnits) {
        const resolved = resolveProgressiveWorkUnit(entries, workUnit);
        if (!resolved.ok) {
          return finalizeFailure(
            db,
            resolved.reason === "manifest_target_field_not_found"
              ? "manifest_target_field_not_found"
              : "manifest_target_not_found",
            resolved.details,
            context
          );
        }
      }
      const targetedKeys = new Set<string>();
      const missingTargets: Array<{
        claim_id: string;
        artifact_path: string;
        entry_id: string;
      }> = [];
      const outcomeStatusMismatches: Array<{
        claim_id: string;
        outcome: DesignSystemExtractionOutcome;
        artifact_path: string;
        entry_id: string;
        entry_status: string;
      }> = [];
      for (const claim of claims) {
        if (claim.outcome !== "mapped" && claim.outcome !== "gap") {
          continue;
        }
        for (const target of claim.targets) {
          const key = entryKey(target.artifactPath, target.entryId);
          targetedKeys.add(key);
          const entry = entriesByKey.get(key);
          if (!entry) {
            missingTargets.push({
              claim_id: claim.claimId,
              artifact_path: target.artifactPath,
              entry_id: target.entryId
            });
            continue;
          }
          const targetShouldBeGap = claim.outcome === "gap";
          if (targetShouldBeGap !== (entry.status === "gap")) {
            outcomeStatusMismatches.push({
              claim_id: claim.claimId,
              outcome: claim.outcome,
              artifact_path: target.artifactPath,
              entry_id: target.entryId,
              entry_status: entry.status
            });
          }
        }
      }
      if (missingTargets.length > 0) {
        return finalizeFailure(
          db,
          "manifest_target_not_found",
          { targets: missingTargets },
          context
        );
      }
      if (outcomeStatusMismatches.length > 0) {
        return finalizeFailure(
          db,
          "manifest_outcome_status_mismatch",
          { targets: outcomeStatusMismatches },
          context
        );
      }

      const lineageMismatches = entries
        .filter(
          (entry) =>
            entry.status !== "gap" &&
            targetedKeys.has(
              entryKey(entry.source_artifact_path, entry.entry_id)
            )
        )
        .flatMap((entry) => {
          const key = entryKey(
            entry.source_artifact_path,
            entry.entry_id
          );
          const targetingSourceIds = new Set(
            claims
              .filter(
                (claim) =>
                  claim.outcome === "mapped" &&
                  claim.targets.some(
                    (target) =>
                      entryKey(target.artifactPath, target.entryId) === key
                  )
              )
              .flatMap((claim) => claim.sourceRecordIds)
          );
          const entryLinks = JSON.parse(entry.links_json) as string[];
          const unclaimedLinkIds = entryLinks.filter(
            (link) => !targetingSourceIds.has(link)
          );
          const unlinkedMappedSourceIds = [...targetingSourceIds].filter(
            (sourceId) => !entryLinks.includes(sourceId)
          );
          return unclaimedLinkIds.length === 0 &&
            unlinkedMappedSourceIds.length === 0
            ? []
            : [
                {
                  source_artifact_path: entry.source_artifact_path,
                  entry_id: entry.entry_id,
                  unclaimed_link_ids: unclaimedLinkIds,
                  unlinked_mapped_source_ids: unlinkedMappedSourceIds
                }
              ];
        });
      if (lineageMismatches.length > 0) {
        return finalizeFailure(
          db,
          "entry_claim_lineage_mismatch",
          { entries: lineageMismatches },
          context
        );
      }

      const uncoveredEntries = entries
        .filter(
          (entry) =>
            entry.status !== "gap" &&
            !targetedKeys.has(
              entryKey(entry.source_artifact_path, entry.entry_id)
            )
        )
        .map((entry) => ({
          source_artifact_path: entry.source_artifact_path,
          entry_id: entry.entry_id
        }));
      if (uncoveredEntries.length > 0) {
        return finalizeFailure(
          db,
          "uncovered_design_system_entries",
          { entries: uncoveredEntries },
          context
        );
      }

      const foundationEntriesWithoutKind = entries
        .filter(
          (entry) =>
            (entry.section.startsWith("foundations.") ||
              entry.section.startsWith("token.") ||
              entry.section === "layout" ||
              entry.section === "interaction") &&
            entry.kind === null
        )
        .map((entry) => ({
          source_artifact_path: entry.source_artifact_path,
          entry_id: entry.entry_id
        }));
      if (foundationEntriesWithoutKind.length > 0) {
        return finalizeFailure(
          db,
          "entry_kind_missing",
          { entries: foundationEntriesWithoutKind },
          context
        );
      }

      const tokensWithoutDomain = entries
        .filter(
          (entry) =>
            entry.section.startsWith("token.") && entry.domain === null
        )
        .map((entry) => ({
          source_artifact_path: entry.source_artifact_path,
          entry_id: entry.entry_id
        }));
      if (tokensWithoutDomain.length > 0) {
        return finalizeFailure(
          db,
          "token_domain_missing",
          { entries: tokensWithoutDomain },
          context
        );
      }

      const specs = entries.filter(
        (entry) => entry.section === "components.spec"
      );
      const missingCaptures = missingComponentCaptures(projectPath, specs);
      if (missingCaptures.length > 0) {
        return finalizeFailure(
          db,
          "component_capture_missing",
          { captures: missingCaptures },
          context
        );
      }
      const missingComponentWorkUnits = entries
        .filter((entry) => entry.section === "components.inventory")
        .filter(
          (entry) =>
            !manifest.workUnits.some(
              (workUnit) => workUnit.key === `component:${entry.entry_id}`
            )
        )
        .map((entry) => `component:${entry.entry_id}`);
      if (missingComponentWorkUnits.length > 0) {
        return finalizeFailure(
          db,
          "extraction_work_units_incomplete",
          { missing_work_unit_keys: missingComponentWorkUnits },
          context
        );
      }
      const missingComponentSpecs = entries
        .filter(
          (entry) =>
            entry.section === "components.inventory" && entry.status !== "gap"
        )
        .flatMap((entry) => {
          const value = JSON.parse(entry.value_json) as {
            specPath?: unknown;
          };
          const specPath =
            typeof value.specPath === "string" ? value.specPath : "";
          const found = specs.some((spec) =>
            specPathMatchesSourceArtifact(
              specPath,
              spec.source_artifact_path
            )
          );
          return found
            ? []
            : [
                {
                  entry_id: entry.entry_id,
                  spec_path: specPath
                }
              ];
        });
      if (missingComponentSpecs.length > 0) {
        return finalizeFailure(
          db,
          "component_specs_missing",
          { components: missingComponentSpecs },
          context
        );
      }

      const incompleteComponentSpecs = specs.flatMap((entry) => {
        const value = JSON.parse(entry.value_json) as Record<string, unknown>;
        const missingFields = RICH_COMPONENT_SPEC_FIELDS.filter(
          (field) => !Object.prototype.hasOwnProperty.call(value, field)
        );
        const unexplainedEmptyFields = RICH_COMPONENT_SPEC_FIELDS.filter(
          (field) =>
            Array.isArray(value[field]) &&
            value[field].length === 0 &&
            !claims.some(
              (claim) =>
                claim.outcome === "omitted" &&
                claim.targets.some(
                  (target) =>
                    entryKey(target.artifactPath, target.entryId) ===
                    entryKey(
                        entry.source_artifact_path,
                        entry.entry_id
                      ) &&
                    target.fieldPath?.join(".") === `value.${field}`
                )
            )
        );
        return missingFields.length === 0 &&
          unexplainedEmptyFields.length === 0
          ? []
          : [
              {
                source_artifact_path: entry.source_artifact_path,
                entry_id: entry.entry_id,
                missing_fields: missingFields,
                unexplained_empty_fields: unexplainedEmptyFields
              }
            ];
      });
      if (incompleteComponentSpecs.length > 0) {
        return finalizeFailure(
          db,
          "component_spec_fields_missing",
          { specs: incompleteComponentSpecs },
          context
        );
      }

      // A formalized entry is an aggregate claim boundary. Every manifest
      // claim targeting it must be confirmed, and at least one of those
      // claims must directly consume a designer-edited answered card.
      const editedCardIds = new Set(
        frozenInput.question_cards
          .filter((card) => card.answer_source === "designer-edited")
          .map((card) => card.id)
      );
      const insufficientFormalizedEntries = entries
        .filter((entry) => entry.status === "formalized")
        .flatMap((entry) => {
          const key = entryKey(entry.source_artifact_path, entry.entry_id);
          const entryClaims = claims.filter(
            (claim) =>
              claim.outcome === "mapped" &&
              claim.targets.some(
                (target) =>
                  entryKey(target.artifactPath, target.entryId) === key
              )
          );
          const supported =
            entryClaims.length > 0 &&
            entryClaims.every((claim) => claim.confidence === "confirmed") &&
            entryClaims.some((claim) =>
              claim.sourceRecordIds.some((id) => editedCardIds.has(id))
            );
          return supported
            ? []
            : [
                {
                  source_artifact_path: entry.source_artifact_path,
                  entry_id: entry.entry_id
                }
              ];
        });
      if (insufficientFormalizedEntries.length > 0) {
        return finalizeFailure(
          db,
          "formalized_claim_support_insufficient",
          { entries: insufficientFormalizedEntries },
          context
        );
      }

      const now = new Date().toISOString();
      db.prepare(
        `UPDATE agent_commands
         SET status = 'completed', completed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'claimed'`
      ).run(now, now, command.id);
      const event = logEventOnDb(
        db,
        "initial_design_system_preparation_completed",
        {
          alignment_attempt_id: alignmentAttemptId,
          agent_command_id: command.id,
          manifest_id: String(manifestRow.id),
          manifest_version: Number(manifestRow.version),
          entry_count: entries.length
        }
      );
      const completed = getAlignmentPreparationOnDb(db);
      const progressive = progressiveExtractionStateOnDb(
        db,
        frozenInput,
        alignmentAttemptId
      );
      return {
        ok: true as const,
        reused: false,
        workflow: completed.workflow,
        attempt: completed.current_attempt!,
        command: completed.commands.find(
          (candidate) => candidate.id === command.id
        )!,
        extraction_work_units: progressive.workUnits,
        extraction_audit: progressive.audit,
        extraction_progress: progressive.progress,
        event_id: event.event_id
      };
    });

    if (result.ok && !result.reused) {
      emitRecordEvent({
        kind: "design-system",
        action: "updated",
        id: alignmentAttemptId,
        projectPath: path.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return {
      ok: false,
      reason: "db_error"
    } as FinalizeInitialDesignSystemFailure;
  }
}
