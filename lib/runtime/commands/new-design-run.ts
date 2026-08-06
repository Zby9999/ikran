import {
  recordNewDesignRun,
  type RecordNewDesignRunInput,
  type RecordNewDesignRunResult
} from "../new-design-run";

export function recordNewDesignRunCommand(
  projectPath: string,
  input: RecordNewDesignRunInput
): RecordNewDesignRunResult {
  return recordNewDesignRun(projectPath, input);
}
