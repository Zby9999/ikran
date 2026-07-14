// Read-only handoff context for Agent-host Figma MCP calls (Issue 05C).
// Runtime returns identity + positional evidence only and never credentials or
// implementation-level Figma properties.

import { closeProjectDb, openProjectDb } from "./db";
import {
  findNodeCorrespondence,
  getAnnotationNodeCandidates,
  parsePositionalNodes,
  type EvidenceBounds,
  type SemanticRect
} from "./figma-positional-evidence";

type ContextError =
  | { ok: false; reason: "seed_reference_not_found" }
  | { ok: false; reason: "surface_not_found" }
  | { ok: false; reason: "positional_evidence_unavailable" }
  | { ok: false; reason: "db_error" };

function parseBounds(value: unknown): EvidenceBounds | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as EvidenceBounds;
    if (
      [parsed.x, parsed.y, parsed.width, parsed.height].every(Number.isFinite) &&
      parsed.width > 0 &&
      parsed.height > 0
    ) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return null;
}

export function getSeedReferenceContext(
  projectPath: string,
  seedReferenceId: string
):
  | {
      ok: true;
      seedReferenceId: string;
      source: { fileKey: string; nodeId: string };
      figmaLink: string;
      currentEvidence: {
        surfaceId: string;
        frameNodeId: string;
        frameName: string;
        capturedAt: string;
      };
    }
  | ContextError {
  const db = openProjectDb(projectPath);
  try {
    const row = db
      .prepare(
        `SELECT sr.id, sr.file_key, sr.node_id, sr.figma_seed_reference,
                fes.id AS surface_id, fes.frame_node_id, fes.frame_name,
                fes.created_at AS captured_at
         FROM seed_references sr
         LEFT JOIN figma_evidence_surfaces fes ON fes.id = sr.current_surface_id
         WHERE sr.id = ?`
      )
      .get(seedReferenceId) as Record<string, unknown> | undefined;
    if (!row) return { ok: false, reason: "seed_reference_not_found" };
    if (typeof row.surface_id !== "string") {
      return { ok: false, reason: "positional_evidence_unavailable" };
    }
    return {
      ok: true,
      seedReferenceId: String(row.id),
      source: { fileKey: String(row.file_key), nodeId: String(row.node_id) },
      figmaLink: String(row.figma_seed_reference),
      currentEvidence: {
        surfaceId: row.surface_id,
        frameNodeId: String(row.frame_node_id),
        frameName: String(row.frame_name),
        capturedAt: String(row.captured_at)
      }
    };
  } catch {
    return { ok: false, reason: "db_error" };
  } finally {
    closeProjectDb(db);
  }
}

export function getAnnotationNodeCandidatesContext(
  projectPath: string,
  input: { surfaceId: string; rect: SemanticRect }
):
  | {
      ok: true;
      surfaceId: string;
      candidates: ReturnType<typeof getAnnotationNodeCandidates>;
    }
  | ContextError {
  const db = openProjectDb(projectPath);
  try {
    const row = db
      .prepare(
        `SELECT id, frame_bounds_json, positional_nodes_json
         FROM figma_evidence_surfaces WHERE id = ?`
      )
      .get(input.surfaceId) as Record<string, unknown> | undefined;
    if (!row) return { ok: false, reason: "surface_not_found" };
    const frameBounds = parseBounds(row.frame_bounds_json);
    const nodes = parsePositionalNodes(
      typeof row.positional_nodes_json === "string"
        ? row.positional_nodes_json
        : null
    );
    if (!frameBounds || nodes.length === 0) {
      return { ok: false, reason: "positional_evidence_unavailable" };
    }
    return {
      ok: true,
      surfaceId: input.surfaceId,
      candidates: getAnnotationNodeCandidates({
        nodes,
        frameBounds,
        rect: input.rect
      })
    };
  } catch {
    return { ok: false, reason: "db_error" };
  } finally {
    closeProjectDb(db);
  }
}

export function getCapturedNodeCorrespondence(
  projectPath: string,
  input: { seedReferenceId: string; capturedNodeId: string }
):
  | {
      ok: true;
      currentSurfaceId: string;
      correspondence: ReturnType<typeof findNodeCorrespondence>;
    }
  | ContextError {
  const db = openProjectDb(projectPath);
  try {
    const row = db
      .prepare(
        `SELECT sr.current_surface_id, fes.positional_nodes_json
         FROM seed_references sr
         LEFT JOIN figma_evidence_surfaces fes ON fes.id = sr.current_surface_id
         WHERE sr.id = ?`
      )
      .get(input.seedReferenceId) as Record<string, unknown> | undefined;
    if (!row) return { ok: false, reason: "seed_reference_not_found" };
    if (typeof row.current_surface_id !== "string") {
      return { ok: false, reason: "positional_evidence_unavailable" };
    }
    const nodes = parsePositionalNodes(
      typeof row.positional_nodes_json === "string"
        ? row.positional_nodes_json
        : null
    );
    if (nodes.length === 0) {
      return { ok: false, reason: "positional_evidence_unavailable" };
    }
    return {
      ok: true,
      currentSurfaceId: row.current_surface_id,
      correspondence: findNodeCorrespondence(nodes, input.capturedNodeId)
    };
  } catch {
    return { ok: false, reason: "db_error" };
  } finally {
    closeProjectDb(db);
  }
}
