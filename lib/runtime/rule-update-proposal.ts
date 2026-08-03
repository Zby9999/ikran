import { withProjectTransaction } from "./db";
import { assertArtifactPathInProject } from "./evidence-package";
import { buildLoggedEvent, insertEvent } from "./events";
import { canonicalizeArtifactPath } from "./source-artifact";

export interface ProposeRuleUpdateInput {
  sourceArtifactPath: string;
  entryId: string;
  proposedTargetPath: string;
  reason: string;
  affectedItems: string[];
  evidenceRecordIds: string[];
}

export type ProposeRuleUpdateResult =
  | {
      ok: true;
      proposal: {
        proposal_id: string;
        source_artifact_path: string;
        entry_id: string;
        proposed_target_path: string;
        reason: string;
        affected_items: string[];
        evidence_record_ids: string[];
        status: "awaiting_confirmation";
      };
      event_id: string;
    }
  | { ok: false; reason: string };

/**
 * Records a proposal-only rule move. This command deliberately does not edit
 * either artifact: confirmation/cancel remains a separate designer-owned flow.
 */
export function proposeRuleUpdate(
  projectPath: string,
  input: ProposeRuleUpdateInput
): ProposeRuleUpdateResult {
  if (
    input.entryId.trim().length === 0 ||
    input.reason.trim().length === 0 ||
    input.affectedItems.length === 0 ||
    input.evidenceRecordIds.length === 0 ||
    input.affectedItems.some((item) => item.trim().length === 0) ||
    input.evidenceRecordIds.some((id) => id.trim().length === 0)
  ) {
    return { ok: false, reason: "invalid_proposal" };
  }
  if (
    assertArtifactPathInProject(projectPath, input.sourceArtifactPath) !== null ||
    assertArtifactPathInProject(projectPath, input.proposedTargetPath) !== null
  ) {
    return { ok: false, reason: "artifact_path_escape" };
  }
  const sourceArtifactPath = canonicalizeArtifactPath(
    projectPath,
    input.sourceArtifactPath
  );
  const proposedTargetPath = canonicalizeArtifactPath(
    projectPath,
    input.proposedTargetPath
  );
  if (sourceArtifactPath === null || proposedTargetPath === null) {
    return { ok: false, reason: "artifact_path_escape" };
  }

  const payload = {
    source_artifact_path: sourceArtifactPath,
    entry_id: input.entryId.trim(),
    proposed_target_path: proposedTargetPath,
    reason: input.reason.trim(),
    affected_items: input.affectedItems.map((item) => item.trim()),
    evidence_record_ids: input.evidenceRecordIds.map((id) => id.trim()),
    status: "awaiting_confirmation" as const
  };
  try {
    const transaction = withProjectTransaction(projectPath, (db) => {
      const entry = db
        .prepare(
          `SELECT 1 FROM design_system_entries
           WHERE source_artifact_path = ? AND entry_id = ?`
        )
        .get(sourceArtifactPath, payload.entry_id);
      if (!entry) {
        return { ok: false as const, reason: "rule_entry_not_found" };
      }
      const evidenceStatements = [
        db.prepare("SELECT 1 FROM alignment_question_cards WHERE id = ?"),
        db.prepare("SELECT 1 FROM agent_alignment_annotations WHERE id = ?"),
        db.prepare("SELECT 1 FROM region_annotations WHERE id = ?"),
        db.prepare("SELECT 1 FROM figma_evidence_surfaces WHERE id = ?"),
        db.prepare("SELECT 1 FROM seed_references WHERE id = ?")
      ];
      for (const recordId of payload.evidence_record_ids) {
        if (!evidenceStatements.some((statement) => statement.get(recordId))) {
          return {
            ok: false as const,
            reason: "evidence_record_not_found"
          };
        }
      }
      const event = buildLoggedEvent(
        "rule_update_proposal_created",
        payload
      );
      insertEvent(db, event);
      return { ok: true as const, event };
    });
    if (!transaction.ok) return transaction;
    const event = transaction.event;
    return {
      ok: true,
      proposal: { proposal_id: event.event_id, ...payload },
      event_id: event.event_id
    };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}
