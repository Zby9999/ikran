export type StudyKitWorkspaceSummary = {
  id: string;
  path: string;
};

export function studyKitStartHere(
  packageName: string,
  workspaces: StudyKitWorkspaceSummary[]
): string;
