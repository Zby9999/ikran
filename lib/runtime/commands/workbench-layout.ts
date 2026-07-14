// Workbench layout commands — UX canvas state (not research / MCP).

import {
  readWorkbenchLayout,
  writeWorkbenchLayout,
  type WorkbenchLayoutDocument,
  type WorkbenchLayoutErrorReason
} from "../workbench-layout";

export type GetWorkbenchLayoutCommandResult =
  | { ok: true; layout: WorkbenchLayoutDocument }
  | { ok: false; reason: WorkbenchLayoutErrorReason };

export function getWorkbenchLayoutCommand(
  projectPath: string
): GetWorkbenchLayoutCommandResult {
  const result = readWorkbenchLayout(projectPath);
  if (!result.ok) return result;
  return { ok: true, layout: result.layout };
}

export type PutWorkbenchLayoutCommandResult =
  | { ok: true; layout: WorkbenchLayoutDocument }
  | { ok: false; reason: WorkbenchLayoutErrorReason };

export function putWorkbenchLayoutCommand(
  projectPath: string,
  input: unknown,
  writeRevision?: number
): PutWorkbenchLayoutCommandResult {
  return writeWorkbenchLayout(projectPath, input, writeRevision);
}
