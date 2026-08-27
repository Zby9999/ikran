export type RuntimeStateDirOptions = {
  appDir: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
};

export function resolveRuntimeStateDir(options: RuntimeStateDirOptions): string;
export function readIkranPackageVersion(appDir: string): string;
