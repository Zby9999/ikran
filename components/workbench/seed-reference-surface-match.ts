import {
  SEED_REFERENCE_PROJECTION_TYPE,
  type SeedReferenceProjectionMeta
} from "./seed-reference-projection-shape";

/** True when projection meta is a linked Figma Evidence Surface. */
export function isFigmaEvidenceSurfaceMeta(
  meta: SeedReferenceProjectionMeta
): meta is SeedReferenceProjectionMeta & {
  kind: "figma_evidence_surface";
  surfaceRecordId: string;
} {
  return (
    meta.kind === "figma_evidence_surface" &&
    typeof meta.surfaceRecordId === "string" &&
    meta.surfaceRecordId.length > 0
  );
}

/** Match a Runtime / canvas surface id against seed-reference projection meta. */
export function seedReferenceMetaMatchesSurfaceId(
  meta: Pick<SeedReferenceProjectionMeta, "surfaceRecordId" | "runtimeRecordId">,
  surfaceId: string
): boolean {
  if (!surfaceId) return false;
  return (
    meta.surfaceRecordId === surfaceId || meta.runtimeRecordId === surfaceId
  );
}

export type SeedReferenceSurfaceShapeLike = {
  type: string;
  meta: unknown;
};

export function isSeedReferenceProjectionShape(
  shape: SeedReferenceSurfaceShapeLike
): shape is SeedReferenceSurfaceShapeLike & { meta: SeedReferenceProjectionMeta } {
  return shape.type === SEED_REFERENCE_PROJECTION_TYPE;
}
