// Shared contract for the `seed_evidence_import` task family.
//
// This is the SINGLE source of truth for the shape that the mocked
// AgentAdapter produces, the Runtime validates (family schema), and the
// Browser UI renders as a Figma Evidence Surface. Defining the schema once
// here and inferring the TypeScript type from it prevents the three call
// sites (adapter / schema / UI) from drifting.
//
// Per AGENTS.md / Issue 04: the Browser UI must render the Evidence Surface
// from Runtime task/API/SSE data only — it must NOT hardcode an evidence
// fixture. Sharing the *type* is fine; only the Runtime/adapter ever
// produces the *values*.

import { z } from "zod";

export const seedEvidenceInputSchema = z.object({
  figmaSeedReference: z.string().min(1),
  originalDesignIntent: z.string().min(1)
});

export const seedEvidenceFrameSchema = z.object({
  id: z.string(),
  name: z.string(),
  bounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number()
  })
});

export const seedEvidenceDesignSignalSchema = z.object({
  id: z.string(),
  label: z.string(),
  evidence: z.string()
});

export const seedEvidenceSurfaceSchema = z.object({
  id: z.string(),
  kind: z.literal("figma"),
  title: z.string(),
  sourceReference: z.string(),
  originalDesignIntent: z.string(),
  dimensions: z.object({
    width: z.number(),
    height: z.number()
  }),
  summary: z.string()
});

export const seedEvidencePackageSchema = z.object({
  packageId: z.string(),
  structuredEvidence: z.object({
    source: seedEvidenceInputSchema,
    frame: seedEvidenceFrameSchema,
    designSignals: z.array(seedEvidenceDesignSignalSchema)
  }),
  evidenceSurface: seedEvidenceSurfaceSchema
});

export type SeedEvidenceInput = z.infer<typeof seedEvidenceInputSchema>;
export type SeedEvidenceFrame = z.infer<typeof seedEvidenceFrameSchema>;
export type SeedEvidenceDesignSignal = z.infer<typeof seedEvidenceDesignSignalSchema>;
export type SeedEvidenceSurface = z.infer<typeof seedEvidenceSurfaceSchema>;
export type SeedEvidencePackage = z.infer<typeof seedEvidencePackageSchema>;