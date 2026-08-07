import {
  captureComponentCodeHero,
  type CaptureComponentCodeHeroInput,
  type CaptureComponentCodeHeroResult
} from "../design-system-code-capture";

/**
 * Agent-triggered code-backed capture (Issue 32): screenshot the component's
 * code rendering and write it back into the spec's sourceCaptures with
 * `origin: "code"`.
 */
export function captureComponentCodeHeroCommand(
  projectPath: string,
  input: CaptureComponentCodeHeroInput
): Promise<CaptureComponentCodeHeroResult> {
  return captureComponentCodeHero(projectPath, input);
}
