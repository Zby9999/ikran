import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { getAlignmentPreparationOnDb } from "./alignment-preparation";
import { withProjectTransaction } from "./db";
import {
  ALIGNMENT_SECTIONS,
  getDesignIntentAlignmentOnDb,
  type AlignmentSection
} from "./design-intent-alignment";
import { logEventOnDb } from "./events";
import { emitRecordEvent } from "./record-bus";
import { listDeclaredArtifacts } from "./source-artifact";
import { specPathMatchesSourceArtifact } from "./design-system-spec-path";
import {
  LAYOUT_RULE_CAPTURE_FIELD,
  LAYOUT_RULE_CAPTURE_OPTIONAL_FIELDS,
  LAYOUT_RULE_CAPTURE_REQUIRED_FIELDS,
  RICH_COMPONENT_SPEC_FIELDS,
  RICH_INTERACTION_RULE_FIELDS,
  RICH_LAYOUT_RULE_FIELDS,
  RICH_PRINCIPLE_COLLECTION_FIELDS,
  RICH_PRINCIPLE_STRING_FIELDS,
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

const RICH_FIELD_WRITING_STYLE = {
  applies_to: {
    layout: ["relationship", "responsiveBehavior", "acceptanceChecks"],
    interaction: [
      "description",
      "behavior",
      "accessibility"
    ],
    component: [
      "anatomy",
      "variants",
      "sizes",
      "usageRules",
      "contentRules",
      "responsiveBehavior",
      "states",
      "motion",
      "verificationTargets",
      "openGaps"
    ]
  },
  rules: [
    "Each array item is one short constraint sentence: one sentence, one rule; never multi-sentence prose.",
    "Put spatial and numeric facts in structured values, such as a dedicated key or the compact value '96 → 56px', instead of burying them in prose.",
    "Put interpretation, rationale, and design intent in meaning, using one sentence only.",
    "Use the language of the designer's source text; if the designer writes Chinese, write the extracted rules in Chinese.",
    "Do not restate existing rules, add padding, or generalize beyond the evidence; unsupported ideas belong in open questions, not source rules."
  ],
  examples: {
    layout: {
      good: {
        value: {
          gap: "20px",
          imageSize: "461.25 × 446px",
          responsiveBehavior: ["窄屏支持触控横向滚动。"],
          acceptanceChecks: ["右侧裁切提示仍可见。"]
        },
        meaning: "横向画廊用于连续浏览项目。"
      },
      bad: {
        relationship: [
          "Project images form a horizontal track with 461.25 × 446px images and 20px gaps. The clipped edge creates a dynamic sense of discovery and should inspire future galleries."
        ]
      }
    },
    interaction: {
      good: {
        value: {
          statement: "动效保持克制。",
          description: "高频工具中的动效只用于解释状态变化。",
          behavior: ["使用短促反馈确认系统已响应。", "避免循环或装饰性动效。"],
          accessibility: ["减少动态效果时保留等价的状态信息。"]
        },
        meaning: "动效服务理解，不争夺注意力。"
      },
      bad: {
        appliesTo: ["Text Link"],
        stateBehavior: [{ state: "hover", behavior: "箭头右移 4px。" }],
        motion: ["160ms ease-out"]
      }
    },
    component: {
      good: {
        value: {
          anatomy: ["CTA 由文字标签和右箭头组成。"],
          contentRules: ["标签使用动词短语。"]
        },
        meaning: "文字链接保持行动入口轻量。"
      },
      bad: {
        usageRules: [
          "Use this sophisticated CTA throughout the product wherever a strong action is needed. It should feel bold, polished, and memorable."
        ]
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
    "Use the token identity for the stable role name and write meaning as one sentence about usage context, function, or design intent.",
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
        letterSpacing: { alias: "primitive.letterSpacing.tight" }
      },
      meaning: "Closing-section call to action."
    },
    bad: {
      name: "typography.connectHeadingSize",
      value: { alias: "primitive.fontSize.37" },
      meaning: "Connect call-to-action heading size role."
    }
  }
} as const;

export const INITIAL_DESIGN_SYSTEM_SOURCE_CONTRACT = {
  schema_version: 2,
  source_root: "design-system",
  file_layout: [
    ...INITIAL_DESIGN_SYSTEM_REQUIRED_ARTIFACTS,
    "design-system/components/<name>.json"
  ],
  entry_envelope: ["value", "meaning", "status", "links"],
  token_domains: TOKEN_DOMAINS,
  component_spec_fields: [
    "description",
    "props",
    "boundaries",
    "stateMatrix",
    ...RICH_COMPONENT_SPEC_FIELDS
  ],
  principle_value_fields: {
    strings: ["statement", ...RICH_PRINCIPLE_STRING_FIELDS],
    collections: RICH_PRINCIPLE_COLLECTION_FIELDS
  },
  layout_rule_value_fields: RICH_LAYOUT_RULE_FIELDS,
  layout_rule_capture_field: {
    field: LAYOUT_RULE_CAPTURE_FIELD,
    item_required: LAYOUT_RULE_CAPTURE_REQUIRED_FIELDS,
    item_optional: LAYOUT_RULE_CAPTURE_OPTIONAL_FIELDS,
    guidance:
      "Optional per-rule Figma node screenshots (09C-D02). Capture the node " +
      "with the Figma MCP (get_screenshot on the rule's frame/section node), " +
      "save the PNG under design-system/captures/<entry>-<node>.png, and " +
      "reference the project-relative path as artifactPath. nodeName and " +
      "capturedAt are required; add nodeId and surfaceId when the provenance " +
      "is known so the browser can mark stale captures. Rules without " +
      "captures render an honest unavailable block — never fabricate one."
  },
  interaction_rule_value_fields: RICH_INTERACTION_RULE_FIELDS,
  interaction_entry_split: {
    interaction_rules: "Cross-component interaction and motion strategies only.",
    component_specs:
      "Component-bound states and motion belong in the matching component spec."
  },
  typography_role_writing_style: TYPOGRAPHY_ROLE_WRITING_STYLE,
  rich_field_writing_style: RICH_FIELD_WRITING_STYLE
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

export type DesignSystemExtractionTarget = {
  artifactPath: string;
  entryId: string;
  jsonPointer: string;
};

export type DesignSystemExtractionClaim = {
  claimId: string;
  section: AlignmentSection;
  statement: string;
  sourceRecordIds: string[];
  sourceExcerpts: string[];
  confidence: "confirmed" | "reasonable";
  outcome: DesignSystemExtractionOutcome;
  reason?: string;
  targets: DesignSystemExtractionTarget[];
};

export type DesignSystemExtractionAudit = {
  status: "passed" | "failed";
  checkedClaimIds: string[];
  issues: string[];
};

export type RecordDesignSystemExtractionManifestInput = {
  alignmentAttemptId: string;
  idempotencyKey: string;
  claims: DesignSystemExtractionClaim[];
  audit: DesignSystemExtractionAudit;
};

export type DesignSystemExtractionManifestRecord = {
  id: string;
  alignment_attempt_id: string;
  agent_command_id: string;
  idempotency_key: string;
  manifest: {
    claims: DesignSystemExtractionClaim[];
    audit: DesignSystemExtractionAudit;
  };
  version: number;
  created_at: string;
  updated_at: string;
};

type ManifestValidationFailure = {
  ok: false;
  reason:
    | "invalid_manifest"
    | "duplicate_claim_id"
    | "invalid_manifest_source"
    | "claim_confidence_exceeds_source"
    | "input_coverage_incomplete"
    | "manifest_audit_incomplete"
    | "stale_alignment_attempt"
    | "initial_design_system_command_not_claimed"
    | "idempotency_conflict"
    | "db_error";
  details?: Record<string, unknown>;
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

function validJsonPointer(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value === "" ||
      (value.startsWith("/") && !/~(?![01])/u.test(value)))
  );
}

function validateManifestShape(
  input: unknown
):
  | { ok: true; input: RecordDesignSystemExtractionManifestInput }
  | ManifestValidationFailure {
  if (!isRecord(input)) return { ok: false, reason: "invalid_manifest" };
  if (
    !nonEmptyString(input.alignmentAttemptId) ||
    !nonEmptyString(input.idempotencyKey) ||
    !Array.isArray(input.claims) ||
    input.claims.length === 0 ||
    !isRecord(input.audit)
  ) {
    return { ok: false, reason: "invalid_manifest" };
  }

  const seen = new Set<string>();
  for (const raw of input.claims) {
    if (!isRecord(raw)) return { ok: false, reason: "invalid_manifest" };
    if (!nonEmptyString(raw.claimId)) {
      return { ok: false, reason: "invalid_manifest" };
    }
    if (seen.has(raw.claimId)) {
      return {
        ok: false,
        reason: "duplicate_claim_id",
        details: { claim_id: raw.claimId }
      };
    }
    seen.add(raw.claimId);
    if (
      typeof raw.section !== "string" ||
      !(ALIGNMENT_SECTIONS as readonly string[]).includes(raw.section) ||
      !nonEmptyString(raw.statement) ||
      !stringArray(raw.sourceRecordIds) ||
      !stringArray(raw.sourceExcerpts) ||
      (raw.confidence !== "confirmed" && raw.confidence !== "reasonable") ||
      !["mapped", "conflict", "omitted", "gap"].includes(
        String(raw.outcome)
      ) ||
      !Array.isArray(raw.targets)
    ) {
      return { ok: false, reason: "invalid_manifest" };
    }
    const needsTarget = raw.outcome === "mapped" || raw.outcome === "gap";
    if (needsTarget && raw.targets.length === 0) {
      return { ok: false, reason: "invalid_manifest" };
    }
    if (
      (raw.outcome === "omitted" || raw.outcome === "conflict") &&
      !nonEmptyString(raw.reason)
    ) {
      return { ok: false, reason: "invalid_manifest" };
    }
    for (const target of raw.targets) {
      if (
        !isRecord(target) ||
        !nonEmptyString(target.artifactPath) ||
        !nonEmptyString(target.entryId) ||
        !validJsonPointer(target.jsonPointer)
      ) {
        return { ok: false, reason: "invalid_manifest" };
      }
    }
  }

  if (
    (input.audit.status !== "passed" && input.audit.status !== "failed") ||
    !stringArray(input.audit.checkedClaimIds) ||
    !stringArray(input.audit.issues, true)
  ) {
    return { ok: false, reason: "invalid_manifest" };
  }
  const checked = new Set(input.audit.checkedClaimIds);
  const missingAuditClaims = [...seen].filter((claimId) => !checked.has(claimId));
  const unknownAuditClaims = [...checked].filter((claimId) => !seen.has(claimId));
  if (missingAuditClaims.length > 0 || unknownAuditClaims.length > 0) {
    return {
      ok: false,
      reason: "manifest_audit_incomplete",
      details: {
        missing_claim_ids: missingAuditClaims,
        unknown_claim_ids: unknownAuditClaims
      }
    };
  }

  return {
    ok: true,
    input: input as unknown as RecordDesignSystemExtractionManifestInput
  };
}

function mapManifestRow(
  row: Record<string, unknown>
): DesignSystemExtractionManifestRecord {
  const manifest = JSON.parse(String(row.manifest_json)) as {
    claims: DesignSystemExtractionClaim[];
    audit: DesignSystemExtractionAudit;
  };
  return {
    id: String(row.id),
    alignment_attempt_id: String(row.alignment_attempt_id),
    agent_command_id: String(row.agent_command_id),
    idempotency_key: String(row.idempotency_key),
    manifest,
    version: Number(row.version),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function getManifestOnDb(
  db: DatabaseType,
  alignmentAttemptId: string
): DesignSystemExtractionManifestRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM design_system_extraction_manifests
       WHERE alignment_attempt_id = ?`
    )
    .get(alignmentAttemptId) as Record<string, unknown> | undefined;
  return row ? mapManifestRow(row) : null;
}

function mapManifestRequestRow(
  row: Record<string, unknown>
): DesignSystemExtractionManifestRecord {
  return {
    id: String(row.manifest_id),
    alignment_attempt_id: String(row.alignment_attempt_id),
    agent_command_id: String(row.agent_command_id),
    idempotency_key: String(row.idempotency_key),
    manifest: JSON.parse(String(row.manifest_json)) as {
      claims: DesignSystemExtractionClaim[];
      audit: DesignSystemExtractionAudit;
    },
    version: Number(row.manifest_version),
    created_at: String(row.created_at),
    updated_at: String(row.created_at)
  };
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
          extraction_manifest: getManifestOnDb(db, attempt.id),
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
        extraction_manifest: getManifestOnDb(db, attempt.id),
        event_id: event.event_id
      };
    });

    if (!claimed.ok) return claimed;

    const { frozen_input: frozenInput, ...claimRecord } = claimed;
    const result = {
      ...claimRecord,
      input_snapshot: frozenInput.input_snapshot,
      annotations: frozenInput.annotations,
      question_cards: frozenInput.question_cards,
      designer_annotations: frozenInput.designer_annotations,
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

export function recordDesignSystemExtractionManifest(
  projectPath: string,
  rawInput: unknown
):
  | {
      ok: true;
      reused: boolean;
      manifest: DesignSystemExtractionManifestRecord;
      event_id: string | null;
    }
  | ManifestValidationFailure {
  const validated = validateManifestShape(rawInput);
  if (!validated.ok) return validated;
  const input = validated.input;

  try {
    const manifestJson = JSON.stringify({
      claims: input.claims,
      audit: input.audit
    });
    const result = withProjectTransaction(projectPath, (db) => {
      const state = getAlignmentPreparationOnDb(db);
      const attempt = state.current_attempt;
      const command = state.commands.find(
        (candidate) =>
          candidate.command_type === "prepare_initial_design_system"
      );
      if (!attempt || attempt.id !== input.alignmentAttemptId || !command) {
        return {
          ok: false,
          reason: "stale_alignment_attempt"
        } as ManifestValidationFailure;
      }
      const priorRequest = db
        .prepare(
          `SELECT * FROM design_system_extraction_manifest_requests
           WHERE alignment_attempt_id = ? AND idempotency_key = ?`
        )
        .get(
          input.alignmentAttemptId,
          input.idempotencyKey
        ) as Record<string, unknown> | undefined;
      if (priorRequest) {
        if (String(priorRequest.manifest_json) !== manifestJson) {
          return {
            ok: false,
            reason: "idempotency_conflict"
          } as ManifestValidationFailure;
        }
        return {
          ok: true as const,
          reused: true,
          manifest: mapManifestRequestRow(priorRequest),
          event_id: null
        };
      }
      if (command.status !== "claimed") {
        return {
          ok: false,
          reason: "initial_design_system_command_not_claimed"
        } as ManifestValidationFailure;
      }
      const frozenInput = ensureFrozenInputOnDb(db, state, command);
      const sourceSections = new Map<string, string | null>([
        ...frozenInput.question_cards.map(
          (card) => [card.id, card.section] as const
        ),
        ...frozenInput.annotations.map(
          (annotation) => [annotation.id, annotation.section] as const
        ),
        ...frozenInput.designer_annotations.map(
          (annotation) => [annotation.id, annotation.section] as const
        )
      ]);
      const sourceConfidence = new Map<string, "confirmed" | "reasonable">([
        ...frozenInput.question_cards.map(
          (card) => [card.id, "confirmed"] as const
        ),
        ...frozenInput.annotations.map(
          (annotation) => [annotation.id, annotation.inference] as const
        ),
        ...frozenInput.designer_annotations.map(
          (annotation) => [annotation.id, "confirmed"] as const
        )
      ]);
      const usedSourceIds = new Set<string>();
      for (const claim of input.claims) {
        for (const sourceId of claim.sourceRecordIds) {
          if (
            !sourceSections.has(sourceId) ||
            sourceSections.get(sourceId) !== claim.section
          ) {
            return {
              ok: false,
              reason: "invalid_manifest_source",
              details: {
                claim_id: claim.claimId,
                source_record_id: sourceId
              }
            } as ManifestValidationFailure;
          }
          usedSourceIds.add(sourceId);
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
            details: {
              claim_id: claim.claimId,
              reasonable_source_record_ids: claim.sourceRecordIds.filter(
                (sourceId) => sourceConfidence.get(sourceId) === "reasonable"
              )
            }
          } as ManifestValidationFailure;
        }
      }

      const missingQuestionCardIds = frozenInput.question_cards
        .filter(
          (card) => card.status === "answered" && !usedSourceIds.has(card.id)
        )
        .map((card) => card.id);
      const missingAgentAnnotationIds = frozenInput.annotations
        .filter((annotation) => !usedSourceIds.has(annotation.id))
        .map((annotation) => annotation.id);
      const missingDesignerAnnotationIds = frozenInput.designer_annotations
        .filter((annotation) => !usedSourceIds.has(annotation.id))
        .map((annotation) => annotation.id);
      if (
        missingQuestionCardIds.length > 0 ||
        missingAgentAnnotationIds.length > 0 ||
        missingDesignerAnnotationIds.length > 0
      ) {
        return {
          ok: false,
          reason: "input_coverage_incomplete",
          details: {
            missing_question_card_ids: missingQuestionCardIds,
            missing_agent_annotation_ids: missingAgentAnnotationIds,
            missing_designer_annotation_ids: missingDesignerAnnotationIds
          }
        } as ManifestValidationFailure;
      }

      const existing = db
        .prepare(
          `SELECT * FROM design_system_extraction_manifests
           WHERE alignment_attempt_id = ?`
        )
        .get(input.alignmentAttemptId) as Record<string, unknown> | undefined;
      if (
        existing &&
        String(existing.idempotency_key) === input.idempotencyKey
      ) {
        if (String(existing.manifest_json) !== manifestJson) {
          return {
            ok: false,
            reason: "idempotency_conflict"
          } as ManifestValidationFailure;
        }
        db.prepare(
          `INSERT OR IGNORE INTO design_system_extraction_manifest_requests
           (alignment_attempt_id, idempotency_key, manifest_id,
            agent_command_id, manifest_json, manifest_version, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          input.alignmentAttemptId,
          input.idempotencyKey,
          String(existing.id),
          command.id,
          manifestJson,
          Number(existing.version),
          String(existing.updated_at)
        );
        return {
          ok: true as const,
          reused: true,
          manifest: mapManifestRow(existing),
          event_id: null
        };
      }

      const now = new Date().toISOString();
      const id = existing ? String(existing.id) : randomUUID();
      const version = existing ? Number(existing.version) + 1 : 1;
      if (existing) {
        db.prepare(
          `UPDATE design_system_extraction_manifests
           SET idempotency_key = ?, manifest_json = ?, version = ?,
               updated_at = ?
           WHERE id = ?`
        ).run(input.idempotencyKey, manifestJson, version, now, id);
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
          version,
          now,
          now
        );
      }
      const event = logEventOnDb(
        db,
        "design_system_extraction_manifest_recorded",
        {
          alignment_attempt_id: input.alignmentAttemptId,
          agent_command_id: command.id,
          manifest_id: id,
          manifest_version: version,
          claim_count: input.claims.length
        }
      );
      db.prepare(
        `INSERT INTO design_system_extraction_manifest_requests
         (alignment_attempt_id, idempotency_key, manifest_id,
          agent_command_id, manifest_json, manifest_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        input.alignmentAttemptId,
        input.idempotencyKey,
        id,
        command.id,
        manifestJson,
        version,
        now
      );
      const stored = db
        .prepare(
          "SELECT * FROM design_system_extraction_manifests WHERE id = ?"
        )
        .get(id) as Record<string, unknown>;
      return {
        ok: true as const,
        reused: false,
        manifest: mapManifestRow(stored),
        event_id: event.event_id
      };
    });

    if (result.ok && !result.reused) {
      emitRecordEvent({
        kind: "design-system",
        action: "updated",
        id: result.manifest.id,
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
    | "extraction_manifest_required"
    | "extraction_audit_failed"
    | "manifest_conflicts_unresolved"
    | "required_artifacts_missing"
    | "manifest_target_not_found"
    | "manifest_target_drift"
    | "manifest_target_section_mismatch"
    | "manifest_outcome_status_mismatch"
    | "entry_claim_lineage_mismatch"
    | "uncovered_design_system_entries"
    | "token_domain_missing"
    | "required_artifacts_not_ingested"
    | "component_specs_missing"
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

function alignmentSectionForEntry(
  entry: DesignSystemEntryKeyRow
): AlignmentSection | null {
  if (entry.section === "foundations.visual-language") return "visual-language";
  if (entry.section === "foundations.principles") return "design-principle";
  if (entry.section.startsWith("token.")) return "token";
  if (entry.section.startsWith("components.")) return "component";
  if (entry.section === "layout") return "layout";
  if (entry.section === "interaction") return "interaction";
  return null;
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
            reason: "extraction_manifest_required"
          } as FinalizeInitialDesignSystemFailure;
        }
        return {
          ok: true as const,
          reused: true,
          workflow: state.workflow,
          attempt,
          command,
          manifest: mapManifestRow(manifestRow),
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
          "extraction_manifest_required",
          undefined,
          context
        );
      }
      const manifest = mapManifestRow(manifestRow);
      if (
        manifest.manifest.audit.status !== "passed" ||
        manifest.manifest.audit.issues.length > 0
      ) {
        return finalizeFailure(
          db,
          "extraction_audit_failed",
          { issues: manifest.manifest.audit.issues },
          context
        );
      }
      const conflicts = manifest.manifest.claims
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
          `SELECT source_artifact_path, entry_id, section, name, domain,
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
      const targetedKeys = new Set<string>();
      const missingTargets: Array<{
        claim_id: string;
        artifact_path: string;
        entry_id: string;
        json_pointer: string;
      }> = [];
      const driftedTargets: Array<{
        claim_id: string;
        artifact_path: string;
        entry_id: string;
        json_pointer: string;
        expected_json_pointer: string;
      }> = [];
      const sectionMismatches: Array<{
        claim_id: string;
        claim_section: AlignmentSection;
        artifact_path: string;
        entry_id: string;
        entry_section: string;
      }> = [];
      const outcomeStatusMismatches: Array<{
        claim_id: string;
        outcome: DesignSystemExtractionOutcome;
        artifact_path: string;
        entry_id: string;
        entry_status: string;
      }> = [];
      for (const claim of manifest.manifest.claims) {
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
              entry_id: target.entryId,
              json_pointer: target.jsonPointer
            });
            continue;
          }
          const expectedPointer = expectedJsonPointer(entry);
          if (target.jsonPointer !== expectedPointer) {
            driftedTargets.push({
              claim_id: claim.claimId,
              artifact_path: target.artifactPath,
              entry_id: target.entryId,
              json_pointer: target.jsonPointer,
              expected_json_pointer: expectedPointer
            });
          }
          const expectedSection = alignmentSectionForEntry(entry);
          if (expectedSection !== null && claim.section !== expectedSection) {
            sectionMismatches.push({
              claim_id: claim.claimId,
              claim_section: claim.section,
              artifact_path: target.artifactPath,
              entry_id: target.entryId,
              entry_section: entry.section
            });
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
      if (driftedTargets.length > 0) {
        return finalizeFailure(
          db,
          "manifest_target_drift",
          { targets: driftedTargets },
          context
        );
      }
      if (sectionMismatches.length > 0) {
        return finalizeFailure(
          db,
          "manifest_target_section_mismatch",
          { targets: sectionMismatches },
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
            manifest.manifest.claims
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
          const explicitlyOmitted = manifest.manifest.claims.some(
            (claim) =>
              claim.section === "component" &&
              claim.outcome === "omitted" &&
              claim.targets.some(
                (target) =>
                  target.jsonPointer === "" &&
                  specPathMatchesSourceArtifact(
                    specPath,
                    target.artifactPath
                  )
              )
          );
          return found || explicitlyOmitted
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
            !manifest.manifest.claims.some(
              (claim) =>
                claim.outcome === "omitted" &&
                claim.targets.some(
                  (target) =>
                    entryKey(target.artifactPath, target.entryId) ===
                    entryKey(
                        entry.source_artifact_path,
                        entry.entry_id
                      ) &&
                    target.jsonPointer ===
                      `/value/${jsonPointerSegment(field)}`
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
          const claims = manifest.manifest.claims.filter(
            (claim) =>
              claim.outcome === "mapped" &&
              claim.targets.some(
                (target) =>
                  entryKey(target.artifactPath, target.entryId) === key
              )
          );
          const supported =
            claims.length > 0 &&
            claims.every((claim) => claim.confidence === "confirmed") &&
            claims.some((claim) =>
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
          manifest_id: manifest.id,
          manifest_version: manifest.version,
          entry_count: entries.length
        }
      );
      const completed = getAlignmentPreparationOnDb(db);
      return {
        ok: true as const,
        reused: false,
        workflow: completed.workflow,
        attempt: completed.current_attempt!,
        command: completed.commands.find(
          (candidate) => candidate.id === command.id
        )!,
        manifest,
        event_id: event.event_id
      };
    });

    if (result.ok && !result.reused) {
      emitRecordEvent({
        kind: "design-system",
        action: "updated",
        id: result.manifest.id,
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
