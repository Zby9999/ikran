// Design-system read commands — HTTP read surface for the Browser in v1
// (09A decision 2: DB is the Runtime truth). No MCP tool exposes these yet;
// the http-mcp-command-parity test only constrains commands registered on
// BOTH surfaces, so MCP exposure is deferred to Task F if the real-Agent
// boundary turns out to need it.

import path from "node:path";
import {
  getDesignSystemView,
  type DesignSystemEntryView,
  type DesignSystemViewResult
} from "../design-system-view";
import { specPathMatchesSourceArtifact } from "../design-system-spec-path";
import {
  approveDesignSystemEntry,
  type ApproveDesignSystemEntryInput,
  type DesignSystemApprovalResult
} from "../design-system-approval";
import {
  editDesignSystemEntry,
  type DesignSystemEditResult,
  type EditDesignSystemEntryInput
} from "../design-system-edit";
import {
  backfillComponentCodeLinks,
  type BackfillCodeLinkMapping,
  type BackfillCodeLinksResult
} from "../design-system-code-backfill";
import { reconcileProtectedDesignSystemSourceMetadata } from "../design-system-sync";
import { emitRecordEvent } from "../record-bus";

/**
 * Apply the designer's direct candidate ↔ formalized selection to the DB and
 * JSON source, append the semantic event, then refresh Browser projections.
 */
export function approveDesignSystemEntryCommand(
  projectPath: string,
  input: ApproveDesignSystemEntryInput
): DesignSystemApprovalResult {
  const reconciliation = reconcileProtectedDesignSystemSourceMetadata(
    projectPath,
    input.sourceArtifactPath
  );
  if (!reconciliation.ok) {
    switch (reconciliation.reason) {
      case "semantic_drift":
      case "schema_validation_failed":
      case "untrusted_source_link":
      case "pending_rule_update_write":
      case "concurrent_db_changed":
        return {
          ok: false,
          reason: "source_db_drift",
          details: reconciliation.details
        };
      case "concurrent_source_changed":
        return { ok: false, reason: "concurrent_source_changed" };
      case "write_failed":
        return { ok: false, reason: "write_failed" };
      case "db_error":
        return { ok: false, reason: "db_error" };
      default:
        // Preserve the approval command's existing, more specific errors for
        // missing/invalid/unregistered sources.
        break;
    }
  }
  const result = approveDesignSystemEntry(
    projectPath,
    input,
    reconciliation.ok && reconciliation.source_content_digest !== undefined
      ? { expectedSourceDigest: reconciliation.source_content_digest }
      : {}
  );
  if (reconciliation.ok && reconciliation.reconciled && !result.ok) {
    // Successful approval emits its own invalidation. On a later approval
    // failure, publish the deferred reconciliation invalidation now so the
    // Browser can clear a stale warning without racing a pre-commit SSE load.
    emitRecordEvent({
      kind: "design-system",
      action: "updated",
      id: reconciliation.source_artifact_path,
      projectPath: path.resolve(projectPath)
    });
  }
  return result;
}

export function editDesignSystemEntryCommand(
  projectPath: string,
  input: EditDesignSystemEntryInput
): DesignSystemEditResult {
  return editDesignSystemEntry(projectPath, input);
}

/**
 * Agent-declared Prototype → Design System code backfill (Issue 31): writes
 * codeLinks back into the source spec JSON files and syncs the DB rows.
 */
export function backfillComponentCodeLinksCommand(
  projectPath: string,
  mappings: readonly BackfillCodeLinkMapping[]
): BackfillCodeLinksResult {
  return backfillComponentCodeLinks(projectPath, mappings);
}

export function getDesignSystemViewCommand(
  projectPath: string
): DesignSystemViewResult {
  return getDesignSystemView(projectPath);
}

export type DesignSystemComponentResult =
  | {
      ok: true;
      component: {
        inventory: DesignSystemEntryView | null;
        spec: DesignSystemEntryView | null;
      };
    }
  | { ok: false; reason: "not_found" | "db_error" | string };

/**
 * Component detail for the Browser: the inventory row plus its spec (matched
 * via the inventory value's specPath against the spec's source artifact
 * path). `componentId` accepts either the inventory entry id or the spec
 * entry id.
 */
export function getDesignSystemComponentCommand(
  projectPath: string,
  componentId: string
): DesignSystemComponentResult {
  const result = getDesignSystemView(projectPath);
  if (!result.ok) return { ok: false, reason: result.reason };

  const inventory =
    result.view.components.inventory.find((e) => e.entry_id === componentId) ??
    null;
  let spec: DesignSystemEntryView | null = null;
  if (inventory) {
    const specPath = (inventory.value as { specPath?: unknown }).specPath;
    spec =
      typeof specPath === "string"
        ? (result.view.components.specs.find((s) =>
            specPathMatchesSourceArtifact(specPath, s.source_artifact_path)
          ) ?? null)
        : null;
  } else {
    spec =
      result.view.components.specs.find((e) => e.entry_id === componentId) ??
      null;
  }

  if (!inventory && !spec) return { ok: false, reason: "not_found" };
  return { ok: true, component: { inventory, spec } };
}
