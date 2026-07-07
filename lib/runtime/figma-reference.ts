export interface ParsedFigmaReference {
  ok: true;
  fileKey: string;
  nodeId: string | null;
}

export type FigmaReferenceValidation =
  | ParsedFigmaReference
  | { ok: false; reason: "invalid_url" | "not_figma" | "missing_file_key" };

export function parseFigmaReference(value: string): FigmaReferenceValidation {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.protocol !== "https:" || url.hostname !== "www.figma.com") {
    return { ok: false, reason: "not_figma" };
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const fileKindIndex = parts.findIndex(
    (part) => part === "design" || part === "file"
  );
  const fileKey = fileKindIndex >= 0 ? parts[fileKindIndex + 1] : "";
  if (!fileKey) {
    return { ok: false, reason: "missing_file_key" };
  }

  const rawNodeId = url.searchParams.get("node-id");
  return {
    ok: true,
    fileKey,
    nodeId: rawNodeId ? normalizeFigmaNodeId(rawNodeId) : null
  };
}

export function normalizeFigmaNodeId(value: string): string {
  return value.trim().replace("-", ":");
}
