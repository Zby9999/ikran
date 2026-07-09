// Per-family output schema hooks. The runner validates adapter "done" output
// against the matching schema AT THE INTAKE POINT ONLY (pass → done,
// fail → failed + invalid_output). No repair re-feed (Issue 13's job).

import { z } from "zod";
import type { OutputSchemaHook, TaskFamily } from "./adapter";

export const familySchemas: Record<TaskFamily, OutputSchemaHook> = {
  project_setup: () =>
    z.object({
      projectId: z.string(),
      steps: z.array(z.string())
    }),
  generate_seed_alignment_questions: () =>
    z.object({
      questions: z.array(z.object({ id: z.string(), text: z.string() }))
    }),
  draft_design_system: () =>
    z.object({
      designSystemId: z.string(),
      foundations: z.record(z.string(), z.unknown()),
      components: z.array(z.object({ id: z.string(), name: z.string() }))
    }),
  reconstruct_seed_prototype: () =>
    z.object({
      prototypeId: z.string(),
      files: z.array(z.object({ path: z.string(), content: z.string() }))
    }),
  generate_design_system_view: () =>
    z.object({
      viewId: z.string(),
      foundations: z.array(z.unknown()),
      components: z.array(z.unknown())
    }),
  create_new_prototype: () =>
    z.object({
      prototypeId: z.string(),
      basedOn: z.string().nullable(),
      files: z.array(z.object({ path: z.string(), content: z.string() }))
    }),
  rule_update: () =>
    z.object({
      proposalId: z.string(),
      ruleId: z.string(),
      change: z.string(),
      rationale: z.string()
    }),
  export_research_package: () =>
    z.object({
      exportId: z.string(),
      manifest: z.object({ files: z.array(z.string()) }),
      format: z.string()
    }),
  // Issue 3A — real_agent_smoke. The smallest honest round-trip a real
  // external Agent CLI can perform. The Agent MUST return JSON conforming to
  // this shape; the runner validates it at the intake point (pass -> done,
  // fail -> failed/invalid_output), reusing the existing Issue 03 path.
  // This family does NOT ingest Figma, call Figma MCP, or write design
  // artifacts — it only proves the adapter boundary works against a real
  // subprocess. Hardening / repair / multi-provider config are Issue 14.
  real_agent_smoke: () =>
    z.object({
      message: z.string(),
      checklist: z.array(z.object({ label: z.string(), done: z.boolean() }))
    })
};
