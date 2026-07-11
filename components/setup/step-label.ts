/** Shared class for in-row setup step labels. */
export function stepLabelClassName(error = false): string {
  return `step-label${error ? " step-label--error" : ""}`;
}
