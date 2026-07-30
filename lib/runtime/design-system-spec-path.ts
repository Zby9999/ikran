// Inventory ↔ spec path pairing (Issue 09A). Kept in its own module with NO
// node imports: the Browser view model (client bundle) value-imports this,
// while lib/runtime/design-system-view.ts pulls node:fs/node:path and can
// never be value-imported from components/.

/**
 * Pair an inventory entry's `specPath` with a spec's source artifact path.
 * The schema only requires a non-empty string, so agents write either the
 * project-relative form ("design-system/components/button.json") or the
 * design-system-root-relative form ("components/button.json") — both are
 * legal and must pair. Both sides are normalized by stripping a leading
 * "design-system/" prefix and then compared exactly: no suffix matching,
 * which would false-positive on paths like "onents/button.json".
 */
export function specPathMatchesSourceArtifact(
  specPath: string,
  sourceArtifactPath: string
): boolean {
  const normalize = (p: string) =>
    p.startsWith("design-system/") ? p.slice("design-system/".length) : p;
  return normalize(specPath) === normalize(sourceArtifactPath);
}
