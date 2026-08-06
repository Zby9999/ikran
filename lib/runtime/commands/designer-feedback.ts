import {
  recordDesignerFeedback,
  type RecordDesignerFeedbackInput,
  type RecordDesignerFeedbackResult
} from "../designer-feedback";

export function recordDesignerFeedbackCommand(
  projectPath: string,
  input: RecordDesignerFeedbackInput
): RecordDesignerFeedbackResult {
  return recordDesignerFeedback(projectPath, input);
}
