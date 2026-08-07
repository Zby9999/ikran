import {
  captureRuleScreenshot,
  type CaptureRuleScreenshotInput,
  type CaptureRuleScreenshotResult
} from "../rule-capture";

export function captureRuleScreenshotCommand(
  projectPath: string,
  input: CaptureRuleScreenshotInput
): Promise<CaptureRuleScreenshotResult> {
  return captureRuleScreenshot(projectPath, input);
}
