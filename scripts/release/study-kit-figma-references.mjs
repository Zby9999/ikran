const FIGMA_FILE_KEY = "zMbujZ9js5LsAXnOdtTAHG";

export const STUDY_KIT_FIGMA_REFERENCES = Object.freeze({
  "kit-1": Object.freeze({
    fileKey: FIGMA_FILE_KEY,
    previousNodeId: "1:2024",
    nodeId: "99:71",
    url: `https://www.figma.com/design/${FIGMA_FILE_KEY}/ikran?node-id=99-71`
  }),
  "kit-2": Object.freeze({
    fileKey: FIGMA_FILE_KEY,
    previousNodeId: "2:1721",
    nodeId: "2:1721",
    url: `https://www.figma.com/design/${FIGMA_FILE_KEY}/ikran?node-id=2-1721`
  })
});

export function figmaReferenceForStudyKit(kitId) {
  const reference = STUDY_KIT_FIGMA_REFERENCES[kitId];
  if (!reference) throw new Error(`Unknown Study Kit Figma reference: ${kitId}`);
  return reference;
}

export function rewriteStudyKitFigmaReferenceText(value, kitId) {
  const reference = figmaReferenceForStudyKit(kitId);
  let rewritten = String(value)
    .replace(/&t=[^"'\\\s]+/g, "")
    .replace(/\?t=[^"'\\\s]+/g, "");

  if (reference.previousNodeId !== reference.nodeId) {
    rewritten = rewritten
      .split(reference.previousNodeId).join(reference.nodeId)
      .split(`node-id=${reference.previousNodeId.replaceAll(":", "-")}`)
      .join(`node-id=${reference.nodeId.replaceAll(":", "-")}`);
  }
  return rewritten;
}
