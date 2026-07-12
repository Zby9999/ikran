// Shared transport-level Zod shapes for HTTP + MCP.
// Domain modules own validation *reasons*; these schemas only describe the
// expected JSON structure so the MCP SDK does not reject payloads before
// domain reasons can surface. Prefer z.string() over enums for fields that
// have domain invalid_* reasons.

import { z } from "zod";

export const registerSeedReferenceInputShape = {
  figmaSeedReference: z.string(),
  originalDesignIntent: z.string()
} as const;

export const registerSeedReferenceInputSchema = z.object(
  registerSeedReferenceInputShape
);

export const createOrOpenProjectInputShape = {
  path: z.string().optional()
} as const;

export const setupWorkspaceInputShape = {
  path: z.string()
} as const;

const frameBoundsShape = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
});

export const recordEvidencePackageInputShape = {
  figmaSeedReference: z.string().optional(),
  seedReferenceId: z.string().optional(),
  // Optional so missing_frame reaches domain instead of MCP InvalidParams.
  frame: z
    .object({
      nodeId: z.string(),
      name: z.string(),
      bounds: frameBoundsShape.optional()
    })
    .optional(),
  evidenceViews: z
    .object({
      // Strings (not enums) so invalid_evidence_views reaches domain.
      rawData: z.string(),
      screenshot: z.string()
    })
    .optional(),
  screenshot: z
    .object({
      artifactPath: z.string().optional(),
      dataUrl: z.string().optional()
    })
    .optional(),
  designSignals: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        evidence: z.string()
      })
    )
    .optional(),
  surfaceBounds: z
    .object({
      width: z.number(),
      height: z.number()
    })
    .optional()
} as const;

export const recordEvidencePackageInputSchema = z.object(
  recordEvidencePackageInputShape
);

export const createRegionAnnotationInputShape = {
  surfaceArtifactId: z.string().optional(),
  surfaceNodeId: z.string().optional(),
  // Optional string (not enum) so missing_author / invalid_author reach domain.
  author: z.string().optional(),
  type: z.string().optional(),
  body: z.string().optional(),
  rect: z
    .object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number()
    })
    .optional(),
  point: z
    .object({
      x: z.number(),
      y: z.number()
    })
    .optional(),
  primaryNodeId: z.string().optional(),
  candidates: z.array(z.unknown()).optional()
} as const;

export const createRegionAnnotationInputSchema = z.object(
  createRegionAnnotationInputShape
);

export const addSeedReferenceInputShape = {
  figmaSeedReference: z.string(),
  referenceNote: z.string().optional()
} as const;

export const addSeedReferenceInputSchema = z.object(addSeedReferenceInputShape);

export const updateSeedReferenceNoteInputShape = {
  id: z.string(),
  /** Pass "" to clear. Field is required so omit does not silently wipe the note. */
  referenceNote: z.string()
} as const;

export const updateSeedReferenceNoteInputSchema = z.object(
  updateSeedReferenceNoteInputShape
);

export const setDesignLanguageDescriptionInputShape = {
  designLanguageDescription: z.string()
} as const;

export const setDesignLanguageDescriptionInputSchema = z.object(
  setDesignLanguageDescriptionInputShape
);

export const connectFigmaInputShape = {
  token: z.string()
} as const;

export const connectFigmaInputSchema = z.object(connectFigmaInputShape);

export type CommandInputParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "invalid_params" };

/**
 * Shared HTTP transport parser. MCP uses the exact same Zod schema objects as
 * `inputSchema`, while HTTP routes call this helper before the domain command.
 * Domain-valid structure can still carry semantically invalid values so the
 * domain layer remains the single source of detailed reasons.
 */
export function parseCommandInput<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown
): CommandInputParseResult<z.infer<T>> {
  const parsed = schema.safeParse(input);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, reason: "invalid_params" };
}
