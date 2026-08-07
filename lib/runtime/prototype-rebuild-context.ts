// Issue 30 — rebuild context for the prototype_validation phase.
//
// Seed reconstruction rebuilds the first prototype from the original Figma
// seed. Runtime returns identity + evidence pointers only; the LIVE current
// Figma design context (fetched by the Agent via the host's own Figma MCP
// get_design_context) is the source of truth for reconstruction. Persisted
// capture screenshots are auxiliary fallback only.

import { closeProjectDb, openProjectDb } from "./db";
import { requireProjectPhase, type ProjectPhase } from "./project-phase";
import { designSystemVersionOnDb } from "./prototype-surface";

/**
 * Static contract handed to the Agent together with the rebuild context.
 * States the reconstruction rules tersely; tool descriptions stay the
 * routing layer.
 */
export const PROTOTYPE_REBUILD_CONTRACT =
  "Rebuild the seed page as the first prototype. Fetch the CURRENT Figma design context via the host's own Figma MCP get_design_context on each seed's source fileKey/nodeId — live Figma is the structural and visual source of truth. Persisted capture screenshots are auxiliary fallback only (via get_figma_connection_status / Figma Connection outage). Use design-system source for reusable tokens/rules, but the seed page structure/copy/layout comes from the live design context, not from invention. Then declare artifacts and call record_preview with these seedReferenceIds and currentEvidence surface ids as evidenceVersionIds.";

export type PrototypeRebuildSeed = {
  seedReferenceId: string;
  figmaLink: string;
  source: { fileKey: string; nodeId: string };
  /** Null while the seed's evidence capture is still pending. */
  currentEvidence: {
    surfaceId: string;
    frameNodeId: string;
    frameName: string;
    capturedAt: string;
  } | null;
};

export type PrototypeRebuildContextResult =
  | {
      ok: true;
      design_system_version: string;
      seeds: PrototypeRebuildSeed[];
      rebuild_contract: string;
    }
  | { ok: false; reason: "phase_gate"; phase: ProjectPhase }
  | { ok: false; reason: "no_seed_reference" }
  | { ok: false; reason: "db_error" };

/**
 * Rebuild context for seed reconstruction: every Seed Reference with its
 * current evidence surface, plus the design-system version. Rejects unless
 * the project is in `prototype_validation`.
 */
export function getPrototypeRebuildContext(
  projectPath: string
): PrototypeRebuildContextResult {
  const gate = requireProjectPhase(projectPath, "prototype_validation");
  if (!gate.ok) {
    return { ok: false, reason: "phase_gate", phase: gate.phase };
  }

  const db = openProjectDb(projectPath);
  try {
    const rows = db
      .prepare(
        `SELECT sr.id, sr.file_key, sr.node_id, sr.figma_seed_reference,
                fes.id AS surface_id, fes.frame_node_id, fes.frame_name,
                fes.created_at AS captured_at
         FROM seed_references sr
         LEFT JOIN figma_evidence_surfaces fes ON fes.id = sr.current_surface_id
         ORDER BY sr.created_at ASC, sr.id ASC`
      )
      .all() as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      return { ok: false, reason: "no_seed_reference" };
    }
    const seeds: PrototypeRebuildSeed[] = rows.map((row) => ({
      seedReferenceId: String(row.id),
      figmaLink: String(row.figma_seed_reference),
      source: { fileKey: String(row.file_key), nodeId: String(row.node_id) },
      currentEvidence:
        typeof row.surface_id === "string"
          ? {
              surfaceId: row.surface_id,
              frameNodeId: String(row.frame_node_id),
              frameName: String(row.frame_name),
              capturedAt: String(row.captured_at)
            }
          : null
    }));
    return {
      ok: true,
      design_system_version: designSystemVersionOnDb(db),
      seeds,
      rebuild_contract: PROTOTYPE_REBUILD_CONTRACT
    };
  } catch {
    return { ok: false, reason: "db_error" };
  } finally {
    closeProjectDb(db);
  }
}
