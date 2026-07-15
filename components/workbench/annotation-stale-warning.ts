import type { RegionAnnotationRecord } from "@/lib/runtime/region-annotation";

export const STALE_ANNOTATION_WARNING =
  "An annotated Figma node no longer exists in the current version.";

export function staleAnnotationWarning(
  annotations: readonly RegionAnnotationRecord[]
): string | null {
  return annotations.some(
    (annotation) =>
      annotation.stale &&
      (annotation.target_kind === "figma-node" ||
        annotation.primary_node_id != null)
  )
    ? STALE_ANNOTATION_WARNING
    : null;
}
