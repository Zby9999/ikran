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
import {
  getRunningComponentFormalizationTiming,
  runComponentFormalizationStage,
  runComponentFormalizationStageAsync,
  updateComponentFormalizationTimingScope
} from "../component-formalization-timing";

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
  const result = runComponentFormalizationStage(
    projectPath,
    "live_hero_declaration",
    { componentCount: input.mappings.length },
    () => declareComponentLiveHeroes(projectPath, input.mappings)
  );
  if (result.ok) {
    const session = getRunningComponentFormalizationTiming(projectPath);
    if (session) {
      try {
        updateComponentFormalizationTimingScope(projectPath, session.id, {
          componentEntryIds: result.entries.map((entry) => entry.entry_id)
        });
      } catch {
        // Timing never changes command behavior.
      }
    }
  }
  return result;
}

/** Runtime-owned sizing helper scaffold; writes the canonical protocol file. */
export function scaffoldComponentHarnessCommand(
  projectPath: string,
  input: ScaffoldComponentHarnessInput
): ScaffoldComponentHarnessResult {
  return runComponentFormalizationStage(
    projectPath,
    "harness_preparation",
    {},
    () => scaffoldComponentHarness(projectPath, input)
  );
}

/** Post-declaration acceptance: load every declared harness headlessly and
 * wait for its v2 geometry report. Observation only — writes nothing. */
export function verifyComponentLiveHeroesCommand(
  projectPath: string,
  input: VerifyComponentLiveHeroesInput
): Promise<VerifyComponentLiveHeroesResult> {
  return runComponentFormalizationStageAsync(
    projectPath,
    "verification",
    { componentCount: input.entryIds?.length },
    async () => {
      const result = await verifyComponentLiveHeroes(projectPath, input);
      if (result.ok) {
        const session = getRunningComponentFormalizationTiming(projectPath);
        if (session) {
          try {
            updateComponentFormalizationTimingScope(projectPath, session.id, {
              componentEntryIds: result.entries.map((entry) => entry.entry_id),
              stateCount: result.entries.reduce(
                (sum, entry) => sum + entry.results.length,
                0
              )
            });
          } catch {
            // Timing never changes command behavior.
          }
        }
      }
      return result;
    }
  );
}
