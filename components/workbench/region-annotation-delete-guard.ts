// Pure delete-permission rules for Region Annotation markers.
// User/keyboard path: Agent markers never deleted; designer blocked in Annotate.
// Authoritative projection (tldraw source !== "user") may remove any marker.

export type RegionAnnotationDeleteSource = "user" | "remote";

export function allowRegionAnnotationDelete(opts: {
  author: "designer" | "agent" | string;
  runtimeRecordId: string | undefined | null;
  source: RegionAnnotationDeleteSource;
  annotateMode: boolean;
}): boolean {
  const rid = opts.runtimeRecordId;
  const isDraft =
    !rid || rid === "draft" || String(rid).startsWith("draft");
  if (isDraft) return true;
  // Projection sync applies authoritative Runtime state via mergeRemoteChanges.
  if (opts.source !== "user") return true;
  if (opts.author !== "designer") return false;
  if (opts.annotateMode) return false;
  return true;
}
