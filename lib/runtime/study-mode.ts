/** Release profile boundary for frozen participant Study Kits. */
export function studyModeEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.IKRAN_STUDY_MODE === "1";
}
