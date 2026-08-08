import {
  claimConsolidateReview,
  dismissDesignerFeedback,
  type ClaimConsolidateReviewResult,
  type DismissDesignerFeedbackInput,
  type DismissDesignerFeedbackResult
} from "../consolidate-review";

export function claimConsolidateReviewCommand(
  projectPath: string,
  input: { reconciliationId: string }
): ClaimConsolidateReviewResult {
  return claimConsolidateReview(projectPath, input.reconciliationId);
}

export function dismissDesignerFeedbackCommand(
  projectPath: string,
  input: DismissDesignerFeedbackInput
): DismissDesignerFeedbackResult {
  return dismissDesignerFeedback(projectPath, input);
}
