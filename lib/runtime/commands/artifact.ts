// Shared source-artifact commands — single source for HTTP + MCP.

import {
  recordSourceArtifact,
  type SourceArtifactRecordResponse
} from "../source-artifact";

export function recordArtifactWrittenCommand(
  projectPath: string,
  input: unknown
): SourceArtifactRecordResponse {
  return recordSourceArtifact(projectPath, input);
}
