export interface StudyKitFigmaReference {
  readonly fileKey: string;
  readonly previousNodeId: string;
  readonly nodeId: string;
  readonly url: string;
}

export const STUDY_KIT_FIGMA_REFERENCES: Readonly<
  Record<"kit-1" | "kit-2", StudyKitFigmaReference>
>;

export function figmaReferenceForStudyKit(
  kitId: string
): StudyKitFigmaReference;

export function rewriteStudyKitFigmaReferenceText(
  value: string,
  kitId: string
): string;
