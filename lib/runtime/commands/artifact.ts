// Shared source-artifact commands — single source for HTTP + MCP.

import {
  recordSourceArtifact,
  type SourceArtifactRecordError,
  type SourceArtifactRecordResult
} from "../source-artifact";
import { runComponentFormalizationStage } from "../component-formalization-timing";
import { canonicalizeArtifactPath } from "../source-artifact";
import { backfillComponentCodeLinks } from "../design-system-code-backfill";
import {
  registerComponentPreview,
  validateComponentPreviewDeclaration,
  type RegisterComponentPreviewInput
} from "../component-preview-registration";
import { closeProjectDb, openProjectDb } from "../db";
import {
  beginAutomaticComponentPreviewOrchestration,
  componentPreviewSemanticContract,
  type AutomaticComponentPreviewOrchestration
} from "../component-preview-orchestration";
import {
  createComponentPreviewException,
  type ComponentPreviewExceptionPacket
} from "../component-preview-exception";

type ArtifactWithComponentPreview = {
  path?: unknown;
  artifactType?: unknown;
  relatedRecordIds?: unknown;
  componentPreview?: RegisterComponentPreviewInput & {
    semanticImpact?: "none" | "possible";
    semanticEvidenceRecordIds?: string[];
    providerRecipe?: Record<string, unknown>;
  };
};

type RecordArtifactWrittenCommandResult =
  | (SourceArtifactRecordResult & {
      component_preview?: {
        ok: true;
      } & (
        | {
            automatic: true;
            idempotent: boolean;
            registration: ReturnType<typeof registerComponentPreview> extends infer R
              ? R extends { ok: true; registration: infer Registration }
                ? Registration
                : never
              : never;
            orchestration: AutomaticComponentPreviewOrchestration;
            next_action: "automatic_verification_queued";
            agent_next_action:
              "declare_remaining_components_then_return_for_prototype_review";
          }
        | {
            automatic: false;
            exception: ComponentPreviewExceptionPacket;
            next_action: "resolve_component_preview_exception";
            agent_next_action: "resolve_component_preview_exception";
          }
      );
    })
  | SourceArtifactRecordError
  | {
      ok: false;
      reason: string;
      details?: unknown;
      artifact_record?: SourceArtifactRecordResult["record"];
      artifact_event_id?: string;
    };

function declaredPreview(input: unknown): ArtifactWithComponentPreview["componentPreview"] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const preview = (input as ArtifactWithComponentPreview).componentPreview;
  return preview && typeof preview === "object" && !Array.isArray(preview)
    ? preview
    : undefined;
}

function existingRegistrationDigest(
  projectPath: string,
  runId: string,
  entryId: string
): string | null {
  const db = openProjectDb(projectPath);
  try {
    const row = db.prepare(
      `SELECT registration_digest FROM component_preview_registrations
       WHERE run_id = ? AND entry_id = ?`
    ).get(runId, entryId) as { registration_digest: string } | undefined;
    return row?.registration_digest ?? null;
  } finally {
    closeProjectDb(db);
  }
}

function keepCodeChangedSurfaceLive(projectPath: string, surfaceId: string): void {
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `UPDATE prototype_surfaces
       SET stale = 0, stale_reason = NULL, updated_at = ?
       WHERE id = ? AND readiness = 'ready' AND stale = 1
         AND stale_reason = 'code_changed'`
    ).run(new Date().toISOString(), surfaceId);
  } finally {
    closeProjectDb(db);
  }
}

function componentSemanticBaseline(
  projectPath: string,
  entryId: string
): { digest: string; states: string[] } | null {
  const db = openProjectDb(projectPath);
  try {
    const row = db.prepare(
      `SELECT value_json FROM design_system_entries
       WHERE id = ? OR entry_id = ?
       ORDER BY CASE WHEN entry_id = ? THEN 0 ELSE 1 END LIMIT 1`
    ).get(entryId, entryId, entryId) as { value_json: string } | undefined;
    return row ? componentPreviewSemanticContract(JSON.parse(row.value_json)) : null;
  } finally {
    closeProjectDb(db);
  }
}

export function recordArtifactWrittenCommand(
  projectPath: string,
  input: unknown
): RecordArtifactWrittenCommandResult {
  const raw = input as ArtifactWithComponentPreview;
  const preview = declaredPreview(input);
  if (preview) {
    const declaredPath =
      typeof raw.path === "string"
        ? canonicalizeArtifactPath(projectPath, raw.path)
        : null;
    const modulePath = canonicalizeArtifactPath(projectPath, preview.modulePath);
    if (
      !declaredPath ||
      !modulePath ||
      declaredPath !== modulePath ||
      (raw.artifactType !== "code" && raw.artifactType !== "prototype")
    ) {
      return {
        ok: false,
        reason: "component_preview_identity_mismatch",
        details: { declaredPath, modulePath }
      };
    }
    const valid = validateComponentPreviewDeclaration(projectPath, preview);
    if (!valid.ok) {
      return {
        ok: false,
        reason: "component_preview_identity_invalid",
        details: { reason: valid.reason, details: valid.details }
      };
    }
  }
  const semanticBaseline = preview
    ? componentSemanticBaseline(projectPath, preview.entryId)
    : null;
  const artifact = runComponentFormalizationStage(
    projectPath,
    "artifact_declaration",
    preview
      ? {
          componentCount: 1,
          stateCount: 1 + Object.keys(preview.stateArgs ?? {}).length
        }
      : {},
    () => recordSourceArtifact(projectPath, input),
    preview
      ? {
          runId: preview.runId,
          startIfMissing: {
            runId: preview.runId,
            componentEntryIds: [preview.entryId],
            stateCount: 1 + Object.keys(preview.stateArgs ?? {}).length
          }
        }
      : {}
  );
  if (!artifact.ok || !preview) return artifact;

  const recipeStates = Object.keys(preview.stateArgs ?? {});
  const undeclaredStates = semanticBaseline
    ? recipeStates.filter((state) => !semanticBaseline.states.includes(state))
    : recipeStates;
  const semanticUncertain =
    preview.semanticImpact !== "none" ||
    semanticBaseline === null ||
    undeclaredStates.length > 0;
  if (preview.providerRecipe !== undefined || semanticUncertain) {
    const kind = preview.providerRecipe !== undefined
      ? "provider_recipe" as const
      : semanticBaseline === null
        ? "missing_evidence" as const
        : "semantic_delta" as const;
    const exception = createComponentPreviewException(projectPath, {
      runId: preview.runId,
      surfaceId: preview.surfaceId,
      entryId: preview.entryId,
      modulePath: artifact.record.path,
      exportName: preview.exportName,
      providerRecipe: preview.providerRecipe,
      kind,
      implementationDelta: {
        semantic_impact: preview.semanticImpact ?? "undeclared",
        provider_recipe: preview.providerRecipe ?? null,
        preview_recipe: {
          run_id: preview.runId,
          surface_id: preview.surfaceId,
          entry_id: preview.entryId,
          module_path: artifact.record.path,
          export_name: preview.exportName,
          default_args: preview.defaultArgs ?? {},
          state_args: preview.stateArgs ?? {}
        },
        undeclared_states: undeclaredStates
      },
      detectedConflicts: [
        ...(preview.providerRecipe !== undefined
          ? ["provider_recipe_requires_judgment"]
          : []),
        ...(preview.providerRecipe === undefined && preview.semanticImpact !== "none"
          ? ["semantic_impact_not_proven_none"]
          : []),
        ...undeclaredStates.map((state) => `state_not_in_component_contract:${state}`)
      ],
      relatedRecordIds: [
        ...(Array.isArray(raw.relatedRecordIds)
          ? raw.relatedRecordIds.filter(
              (id): id is string => typeof id === "string" && id.trim().length > 0
            )
          : []),
        ...(preview.semanticEvidenceRecordIds ?? [])
      ]
    });
    return {
      ...artifact,
      component_preview: {
        ok: true,
        automatic: false,
        exception,
        next_action: "resolve_component_preview_exception",
        agent_next_action: "resolve_component_preview_exception"
      }
    };
  }

  const priorDigest = existingRegistrationDigest(
    projectPath,
    preview.runId,
    preview.entryId
  );
  const linked = runComponentFormalizationStage(
    projectPath,
    "component_code_linking",
    { componentCount: 1 },
    () => backfillComponentCodeLinks(projectPath, [
      { entryId: preview.entryId, codeLinks: [artifact.record.path] }
    ]),
    { runId: preview.runId }
  );
  if (!linked.ok) {
    return {
      ok: false,
      reason: "component_preview_link_failed",
      details: { stage: "component_code_linking", reason: linked.reason },
      artifact_record: artifact.record,
      artifact_event_id: artifact.event_id
    };
  }
  // A normal code declaration invalidates audit freshness, not a reachable
  // dev server. Issue 45 makes this distinction explicit in the read model;
  // keep the same ready surface eligible for the shared adapter now.
  runComponentFormalizationStage(
    projectPath,
    "preview_readiness",
    { componentCount: 1 },
    () => {
      keepCodeChangedSurfaceLive(projectPath, preview.surfaceId);
      return { ok: true as const };
    },
    { runId: preview.runId }
  );
  const registration = runComponentFormalizationStage(
    projectPath,
    "harness_preparation",
    { componentCount: 1 },
    () => registerComponentPreview(projectPath, preview),
    { runId: preview.runId }
  );
  if (!registration.ok) {
    return {
      ok: false,
      reason: "component_preview_link_failed",
      details: {
        stage: "preview_registration",
        reason: registration.reason,
        details: registration.details
      },
      artifact_record: artifact.record,
      artifact_event_id: artifact.event_id
    };
  }
  const orchestration = beginAutomaticComponentPreviewOrchestration(
    projectPath,
    registration.registration.id,
    semanticBaseline!.digest
  );
  return {
    ...artifact,
    component_preview: {
      ok: true,
      automatic: true,
      idempotent:
        priorDigest !== null &&
        priorDigest === registration.registration.registration_digest,
      registration: registration.registration,
      orchestration,
      next_action: "automatic_verification_queued",
      agent_next_action:
        "declare_remaining_components_then_return_for_prototype_review"
    }
  };
}
