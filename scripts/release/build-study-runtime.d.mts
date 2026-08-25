export interface StudyRuntimeBuildResult {
  readonly bundle: string;
  readonly bytes: number;
  readonly runtimeTranspiler: "precompiled";
  readonly nextConfig: "precompiled-esm";
  readonly embeddedEsbuildExecutables: 0;
}

export function buildStudyRuntime(options: {
  sourceRoot: string;
  destinationRoot: string;
}): StudyRuntimeBuildResult;

export function patchRuntimeEntry(input: string, file?: string): string;
