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
import {
  scaffoldComponentHarness,
  type ScaffoldComponentHarnessInput,
  type ScaffoldComponentHarnessResult
} from "../harness-scaffold";
import {
  verifyComponentLiveHeroes,
  type VerifyComponentLiveHeroesInput,
  type VerifyComponentLiveHeroesResult
} from "../live-hero-verify";

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

/** Runtime-owned sizing helper scaffold; writes the canonical protocol file. */
export function scaffoldComponentHarnessCommand(
  projectPath: string,
  input: ScaffoldComponentHarnessInput
): ScaffoldComponentHarnessResult {
  return scaffoldComponentHarness(projectPath, input);
}

/** Post-declaration acceptance: load every declared harness headlessly and
 * wait for its v2 geometry report. Observation only — writes nothing. */
export function verifyComponentLiveHeroesCommand(
  projectPath: string,
  input: VerifyComponentLiveHeroesInput
): Promise<VerifyComponentLiveHeroesResult> {
  return verifyComponentLiveHeroes(projectPath, input);
}
