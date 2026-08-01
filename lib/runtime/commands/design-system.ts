// Design-system read commands — HTTP read surface for the Browser in v1
// (09A decision 2: DB is the Runtime truth). No MCP tool exposes these yet;
// the http-mcp-command-parity test only constrains commands registered on
// BOTH surfaces, so MCP exposure is deferred to Task F if the real-Agent
// boundary turns out to need it.

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
  answerDesignSystemOpenQuestion,
  type AnswerDesignSystemOpenQuestionInput,
  type DesignSystemOpenQuestionAnswerResult
} from "../design-system-open-question";

/**
 * Candidate → formalized approval (09A decision 5): flips the DB row and
 * writes the JSON source file back canonically, logs
 * design_system_entry_approved, then invalidates the Browser and
 * regenerates the derived export.
 */
export function approveDesignSystemEntryCommand(
  projectPath: string,
  input: ApproveDesignSystemEntryInput
): DesignSystemApprovalResult {
  return approveDesignSystemEntry(projectPath, input);
}

/**
 * Open Questions write (09C-B03): the designer answers one open question
 * from the Atlas card's panel — the question moves from openQuestions to
 * openQuestionAnswers in BOTH the JSON source file (canonical write-back)
 * and the DB row, logs design_system_open_question_answered, then
 * invalidates the Browser and regenerates the derived export.
 */
export function answerDesignSystemOpenQuestionCommand(
  projectPath: string,
  input: AnswerDesignSystemOpenQuestionInput
): DesignSystemOpenQuestionAnswerResult {
  return answerDesignSystemOpenQuestion(projectPath, input);
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
