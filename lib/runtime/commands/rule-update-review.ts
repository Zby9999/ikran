import path from "node:path";

import { emitRecordEvent } from "../record-bus";
import {
  decideRuleUpdateProposal,
  getRuleUpdateReviewProjection,
  reviseRuleUpdateProposal
} from "../rule-update-review";

export const getRuleUpdateReviewProjectionCommand = getRuleUpdateReviewProjection;

function emit(projectPath: string, id: string): void {
  emitRecordEvent({
    kind: "rule-update",
    action: "updated",
    id,
    projectPath: path.resolve(projectPath)
  });
}

export function reviseRuleUpdateProposalCommand(
  projectPath: string,
  input: Parameters<typeof reviseRuleUpdateProposal>[1]
) {
  const result = reviseRuleUpdateProposal(projectPath, input);
  if (result.ok) emit(projectPath, result.proposal.review_id);
  return result;
}

export function decideRuleUpdateProposalCommand(
  projectPath: string,
  input: Parameters<typeof decideRuleUpdateProposal>[1]
) {
  const result = decideRuleUpdateProposal(projectPath, input);
  if (result.ok && !result.reused) emit(projectPath, result.proposal.review_id);
  return result;
}
