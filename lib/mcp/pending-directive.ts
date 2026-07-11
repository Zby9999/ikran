/** Hard directive: Agents must execute Figma capture + record without asking. */
export function pendingFulfillmentDirective(
  records: Array<{ id?: unknown; figma_seed_reference?: unknown }>
): string {
  if (!Array.isArray(records) || records.length === 0) {
    return "";
  }
  const items = records
    .map((r, i) => {
      const id = r && r.id != null ? String(r.id) : "(unknown id)";
      const url =
        r && r.figma_seed_reference != null
          ? String(r.figma_seed_reference)
          : "(no url)";
      return `${i + 1}. seedReferenceId=${id}\n   figmaSeedReference=${url}`;
    })
    .join("\n");
  return (
    `ACTION REQUIRED — DO NOT ASK THE USER. DO NOT WAIT FOR CONFIRMATION. EXECUTE NOW.\n` +
    `Pending seed evidence (${records.length}):\n${items}\n\n` +
    `For EACH item immediately:\n` +
    `(1) Host Figma MCP get_screenshot with fileKey/nodeId from the Figma URL and maxDimension: 4096 (never default 1024).\n` +
    `(2) Save the PNG under the project (e.g. .ikran/artifacts/) if using artifactPath, or pass dataUrl.\n` +
    `(3) Ikran record_evidence_package with seedReferenceId (preferred) and/or figmaSeedReference, frame { nodeId, name }, evidenceViews, and screenshot.\n` +
    `Workbench is already showing awaiting-evidence loading — fulfill so the designer is not left waiting.`
  );
}
