export interface StudyPluginSmokeResult {
  readonly ok: true;
  readonly aliases: readonly string[];
  readonly route: "/api/project";
}

export function assertPortableNextExternals(root: string): {
  readonly aliases: readonly string[];
};

export function smokeStudyPlugin(options: {
  root: string;
  timeoutMs?: number;
}): Promise<StudyPluginSmokeResult>;
