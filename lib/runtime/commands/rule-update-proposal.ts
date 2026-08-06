import {
  cancelRuleUpdate,
  confirmRuleUpdate,
  proposeRuleUpdate,
  type CancelRuleUpdateResult,
  type ConfirmRuleUpdateResult,
  type ProposeRuleUpdateInput,
  type ProposeRuleUpdateResult,
  type RuleUpdateDecisionInput
} from "../rule-update-proposal";

export function proposeRuleUpdateCommand(
  projectPath: string,
  input: ProposeRuleUpdateInput
): ProposeRuleUpdateResult {
  return proposeRuleUpdate(projectPath, input);
}

export function confirmRuleUpdateCommand(
  projectPath: string,
  input: RuleUpdateDecisionInput
): ConfirmRuleUpdateResult {
  return confirmRuleUpdate(projectPath, input);
}

export function cancelRuleUpdateCommand(
  projectPath: string,
  input: RuleUpdateDecisionInput
): CancelRuleUpdateResult {
  return cancelRuleUpdate(projectPath, input);
}
