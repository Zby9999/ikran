import {
  cancelRuleUpdate,
  confirmRuleUpdate,
  proposeRuleUpdate,
  type ProposeRuleUpdateInput,
  type RuleUpdateDecisionInput
} from "../rule-update-proposal";
import {
  claimRuleUpdateDecision,
  createRuleUpdateReview,
  decideRuleUpdateProposal,
  draftRuleUpdateProposal,
  failRuleUpdateApply,
  publishRuleUpdateReview,
  retryRuleUpdateApply
} from "../rule-update-review";
import path from "node:path";
import { emitRecordEvent } from "../record-bus";

type ManagedProposalInput = ProposeRuleUpdateInput & {
  reviewId?: string;
  fullRuleBody?: string;
  targetCategory?: string;
  sourceCategory?: string;
};

function emitReview(projectPath: string, reviewId: string): void {
  emitRecordEvent({
    kind: "rule-update",
    action: "updated",
    id: reviewId,
    projectPath: path.resolve(projectPath)
  });
}

export function proposeRuleUpdateCommand(
  projectPath: string,
  input: ManagedProposalInput
) {
  if (input.reviewId) {
    const result = draftRuleUpdateProposal(projectPath, {
      reviewId: input.reviewId,
      kind: input.kind ?? "update",
      classification: input.classification ?? "proposed_update",
      title: input.title ?? "",
      changeDescription: input.changeDescription,
      fullRuleBody: input.fullRuleBody ?? input.changeDescription ?? "",
      reason: input.reason,
      affectedItems: input.affectedItems,
      evidenceRecordIds: input.evidenceRecordIds,
      target: {
        category: input.targetCategory ?? "",
        sourceCategory: input.sourceCategory,
        sourceArtifactPath: input.sourceArtifactPath,
        entryId: input.entryId,
        proposedTargetPath: input.proposedTargetPath
      }
    });
    if (result.ok) emitReview(projectPath, result.proposal.review_id);
    return result;
  }
  return proposeRuleUpdate(projectPath, input);
}

export function confirmRuleUpdateCommand(
  projectPath: string,
  input: RuleUpdateDecisionInput
){
  const managed = decideRuleUpdateProposal(projectPath, {
    proposalId: input.proposalId,
    decision: "accepted"
  });
  if (managed.ok && !managed.reused) emitReview(projectPath, managed.proposal.review_id);
  if (
    managed.ok ||
    (managed.reason !== "proposal_not_managed" &&
      managed.reason !== "proposal_not_found")
  ) return managed;
  return confirmRuleUpdate(projectPath, input);
}

export function cancelRuleUpdateCommand(
  projectPath: string,
  input: RuleUpdateDecisionInput
){
  const managed = decideRuleUpdateProposal(projectPath, {
    proposalId: input.proposalId,
    decision: "rejected"
  });
  if (managed.ok && !managed.reused) emitReview(projectPath, managed.proposal.review_id);
  if (
    managed.ok ||
    (managed.reason !== "proposal_not_managed" &&
      managed.reason !== "proposal_not_found")
  ) return managed;
  return cancelRuleUpdate(projectPath, input);
}

export function createRuleUpdateReviewCommand(
  projectPath: string,
  input: Parameters<typeof createRuleUpdateReview>[1]
) {
  const result = createRuleUpdateReview(projectPath, input);
  if (result.ok) emitReview(projectPath, result.review.id);
  return result;
}

export function publishRuleUpdateReviewCommand(projectPath: string, reviewId: string) {
  const result = publishRuleUpdateReview(projectPath, reviewId);
  if (result.ok) emitReview(projectPath, result.review.id);
  return result;
}

export function claimRuleUpdateDecisionCommand(projectPath: string) {
  const result = claimRuleUpdateDecision(projectPath);
  if (result.ok) emitReview(projectPath, result.proposal.review_id);
  return result;
}

export function failRuleUpdateApplyCommand(
  projectPath: string,
  input: Parameters<typeof failRuleUpdateApply>[1]
) {
  const result = failRuleUpdateApply(projectPath, input);
  if (result.ok) emitReview(projectPath, input.commandId);
  return result;
}

export function retryRuleUpdateApplyCommand(projectPath: string, commandId: string) {
  const result = retryRuleUpdateApply(projectPath, commandId);
  if (result.ok) emitReview(projectPath, commandId);
  return result;
}
