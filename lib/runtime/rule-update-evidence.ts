import type { DatabaseSync as DatabaseType } from "node:sqlite";

/** Evidence records that may provide provenance for an applied Rule Update. */
export function canonicalRuleUpdateSourceEvidenceOnDb(
  db: DatabaseType,
  evidenceRecordIds: readonly string[]
): string[] {
  const card = db.prepare(
    `SELECT 1 FROM alignment_question_cards
     WHERE id = ? AND final_answer IS NOT NULL AND TRIM(final_answer) <> ''`
  );
  const annotation = db.prepare(
    "SELECT 1 FROM agent_alignment_annotations WHERE id = ?"
  );
  const feedback = db.prepare("SELECT 1 FROM designer_feedback WHERE id = ?");
  return evidenceRecordIds.filter(
    (id) => card.get(id) || annotation.get(id) || feedback.get(id)
  );
}

/** Shared provenance predicate for proposal preflight and source ingestion. */
export function checkRuleUpdateEvidenceLinksOnDb(
  db: DatabaseType,
  evidenceRecordIds: readonly string[],
  observedLinks: readonly string[],
  options: { allowNoSourceEvidence?: boolean } = {}
):
  | { ok: true; sourceEvidenceRecordIds: string[] }
  | {
      ok: false;
      sourceEvidenceRecordIds: string[];
      details: {
        required_evidence_record_ids: string[];
        observed_links: string[];
      };
    } {
  const sourceEvidenceRecordIds = canonicalRuleUpdateSourceEvidenceOnDb(
    db,
    evidenceRecordIds
  );
  if (
    (options.allowNoSourceEvidence === true &&
      sourceEvidenceRecordIds.length === 0) ||
    sourceEvidenceRecordIds.some((id) => observedLinks.includes(id))
  ) {
    return { ok: true, sourceEvidenceRecordIds };
  }
  return {
    ok: false,
    sourceEvidenceRecordIds,
    details: {
      required_evidence_record_ids: sourceEvidenceRecordIds,
      observed_links: [...observedLinks]
    }
  };
}
