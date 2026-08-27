export type RuntimeSocketPathOptions = {
  platform?: NodeJS.Platform;
  tempDirectory?: string;
  uid?: number | string;
};

export function resolveRuntimeSocketPath(
  stateDirectory: string,
  options?: RuntimeSocketPathOptions
): string;
