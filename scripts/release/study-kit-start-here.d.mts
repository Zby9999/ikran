export type StudyKitWorkspaceSummary = {
  id: string;
  workspaceNumber: number;
  displayName: string;
  path: string;
  frame: {
    fileKey: string;
    nodeId: string;
    name: string;
  };
};

export function studyKitStartHere(
  packageName: string,
  workspaces: StudyKitWorkspaceSummary[]
): string;
