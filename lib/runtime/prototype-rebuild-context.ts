// Issue 30 — rebuild context for the prototype_validation phase.
//
// Seed reconstruction rebuilds the first prototype from the original Figma
// seed. Runtime returns identity + evidence pointers only; the LIVE current
// Figma design context (fetched by the Agent via the host's own Figma MCP
// get_design_context) is the source of truth for reconstruction. Persisted
// capture screenshots are auxiliary fallback only.

import { closeProjectDb, openProjectDb } from "./db";
import {
  ensureActiveDesignSystemRevision,
  readActiveDesignSystemRevisionOnDb
} from "./design-system-revision";
import { requireProjectPhase, type ProjectPhase } from "./project-phase";
import { designSystemVersionOnDb } from "./prototype-surface";

/**
 * Static contract handed to the Agent together with the rebuild context.
 * States the reconstruction rules tersely; tool descriptions stay the
 * routing layer.
 */
export const PROTOTYPE_REBUILD_CONTRACT =
  "Rebuild the seed page as the first prototype. Fetch the CURRENT Figma design context via the host's own Figma MCP get_design_context on each seed's source fileKey/nodeId — live Figma is the structural and visual source of truth. If that host-native Figma read is unavailable, stop with a Figma MCP preflight failure; never request or store a Figma API token through Ikran. Use only the active Design System revision for reusable tokens/rules; the seed page structure/copy/layout comes from the live design context, not from invention. Then declare artifacts and call record_preview with these seedReferenceIds and currentEvidence surface ids as evidenceVersionIds.";

/** Machine-readable preview handoff; prose above remains reconstruction guidance. */
export const PROTOTYPE_PREVIEW_CONTRACT = Object.freeze({
  sequence: [
    "write_complete_prototype",
    "declare_prototype_and_package_artifacts",
    "record_preview_once",
    "verify_ready_surface"
  ],
  server: {
    processOwner: "runtime",
    host: "127.0.0.1",
    portEnvironmentVariable: "PORT"
  },
  declaration: {
    sourceArtifactPath: "declared prototype/code entry artifact",
    prototypeRoot: "directory containing package.json",
    routePath: "explicit absolute page path, such as /",
    packageMetadata: ["scripts.dev", "dependencies", "devDependencies"]
  },
  completion: { readiness: "ready", stale: false },
  repair: {
    error: "preview_not_ready",
    retryIdentity: "same runId and surfaceKey"
  },
  componentPreview: {
    supportedAdapters: ["next-app-router", "vite-react"],
    adapterSelection: "runtime-detected from prototype structure and package metadata",
    styles: {
      componentImports: "loaded normally",
      viteEntryCss: "direct CSS imports from the index.html module entry are included automatically"
    },
    versionPolicy: "framework package version changes do not select an adapter",
    recipeRules: {
      entryId: "use the exact entryId from component_preview_targets",
      stateArgs:
        "keys must come from allowedStateNames; omit stateArgs for alternative examples not declared by the Design System contract"
    },
    completionGate: "before Prototype confirmation every code-linked candidate component must be registered for live verification or retain a resolved Open Gap; formalization additionally requires verification"
  }
} as const);

export type PrototypeComponentPreviewTarget = {
  entryId: string;
  name: string;
  sourceArtifactPath: string;
  allowedStateNames: string[];
};

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
      design_system_revision: {
        id: string;
        sequence: number;
        digest: string;
      } | null;
      seeds: PrototypeRebuildSeed[];
      component_preview_targets: PrototypeComponentPreviewTarget[];
      rebuild_contract: string;
      preview_contract: typeof PROTOTYPE_PREVIEW_CONTRACT;
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

  ensureActiveDesignSystemRevision(projectPath);

  const db = openProjectDb(projectPath);
  try {
    const revision = readActiveDesignSystemRevisionOnDb(db);
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
    const componentPreviewTargets = (
      db.prepare(
        `SELECT entry_id, name, source_artifact_path, value_json
         FROM design_system_entries
         WHERE file_kind = 'component-spec' AND status = 'candidate'
         ORDER BY position ASC, entry_id ASC`
      ).all() as Array<{
        entry_id: string;
        name: string | null;
        source_artifact_path: string;
        value_json: string;
      }>
    ).map((row) => {
      let allowedStateNames: string[] = [];
      try {
        const value = JSON.parse(row.value_json) as {
          stateMatrix?: Array<{ state?: unknown }>;
        };
        const seen = new Set<string>();
        for (const item of value.stateMatrix ?? []) {
          if (typeof item?.state !== "string") continue;
          const state = item.state.trim();
          if (!state || state.toLowerCase() === "default" || seen.has(state)) {
            continue;
          }
          seen.add(state);
        }
        allowedStateNames = [...seen];
      } catch {
        // Malformed entries are rejected by ingestion; expose no state recipe
        // rather than teaching the Agent to guess one.
      }
      return {
        entryId: row.entry_id,
        name: row.name ?? row.entry_id,
        sourceArtifactPath: row.source_artifact_path,
        allowedStateNames
      };
    });
    return {
      ok: true,
      design_system_version: revision?.digest ?? designSystemVersionOnDb(db),
      design_system_revision: revision
        ? { id: revision.id, sequence: revision.sequence, digest: revision.digest }
        : null,
      seeds,
      component_preview_targets: componentPreviewTargets,
      rebuild_contract: PROTOTYPE_REBUILD_CONTRACT,
      preview_contract: PROTOTYPE_PREVIEW_CONTRACT
    };
  } catch {
    return { ok: false, reason: "db_error" };
  } finally {
    closeProjectDb(db);
  }
}
