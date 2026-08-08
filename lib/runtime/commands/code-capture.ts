import {
  captureComponentCodeHero,
  type CaptureComponentCodeHeroInput,
  type CaptureComponentCodeHeroResult
} from "../design-system-code-capture";
import {
  declareComponentLiveHeroes,
  type ComponentLiveHeroMapping,
  type DeclareComponentLiveHeroesResult
} from "../design-system-live-hero";

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

/** Issue 33 live path: metadata-only batch declaration; no browser or PNG. */
export function declareComponentLiveHeroesCommand(
  projectPath: string,
  input: { mappings: readonly ComponentLiveHeroMapping[] }
): DeclareComponentLiveHeroesResult {
  return declareComponentLiveHeroes(projectPath, input.mappings);
}
