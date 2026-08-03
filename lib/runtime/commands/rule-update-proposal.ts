import {
  proposeRuleUpdate,
  type ProposeRuleUpdateInput,
  type ProposeRuleUpdateResult
} from "../rule-update-proposal";

export function proposeRuleUpdateCommand(
  projectPath: string,
  input: ProposeRuleUpdateInput
): ProposeRuleUpdateResult {
  return proposeRuleUpdate(projectPath, input);
}
