// Shared alignment staging for Playwright specs (Issue 07 flow reused by
// 08/09/09A tests). Drives the real MCP tools: claim the preparation command,
// create one Agent annotation + two proposed question cards per section (the
// finalize gate requires annotations for ALL six sections and 2–5 proposed
// cards each), then finalize into the answering stage. Answering itself stays
// with the caller — specs choose which cards become designer-edited (HTTP
// surface, own wording) vs agent-proposed-designer-accepted (proposed text).

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { structuredContent } from "./mcp";

export const ALIGNMENT_SECTIONS = [
  "design-concept",
  "visual-language",
  "token",
  "layout",
  "component",
  "interaction"
] as const;

export type StagedCard = { id: string; answer: string; optionId: string };

export type StagedAlignment = {
  attemptId: string;
  /** Section → Agent annotation id (candidate-grade links for 09A). */
  annotationIds: Record<string, string>;
  /** Section → the two proposed cards (id + proposed answer text). */
  cards: Record<string, StagedCard[]>;
};

/**
 * Claim → annotate → propose → finalize. Throws on any failed tool call so a
 * broken staging step fails the spec at its real cause, not downstream.
 */
export async function stageAlignmentAnswering(
  client: Client,
  args: {
    seedReferenceId: string;
    evidenceId: string;
    /** Idempotency-key prefix; must be unique per project. */
    keyPrefix: string;
  }
): Promise<StagedAlignment> {
  const anchor = {
    kind: "single",
    target: {
      kind: "surface",
      seedReferenceId: args.seedReferenceId,
      evidenceSurfaceId: args.evidenceId,
      evidenceVersionId: args.evidenceId
    }
  };

  const claimed = structuredContent(await client.callTool({
    name: "claim_alignment_preparation",
    arguments: {}
  }));
  if (claimed.ok !== true) {
    throw new Error(`claim_alignment_preparation failed: ${JSON.stringify(claimed)}`);
  }
  const attemptId = String((claimed.attempt as { id: string }).id);

  const annotationIds: Record<string, string> = {};
  const cards: Record<string, StagedCard[]> = {};
  for (const section of ALIGNMENT_SECTIONS) {
    const annotation = structuredContent(await client.callTool({
      name: "create_agent_annotation",
      arguments: {
        alignmentAttemptId: attemptId,
        idempotencyKey: `${args.keyPrefix}:${section}:assumption`,
        section,
        inference: "reasonable",
        title: "Section Hypothesis",
        body: `The current ${section} choices appear intentional.`,
        anchor
      }
    }));
    if (annotation.ok !== true) {
      throw new Error(
        `create_agent_annotation(${section}) failed: ${JSON.stringify(annotation)}`
      );
    }
    annotationIds[section] = String((annotation.record as { id: string }).id);

    cards[section] = [];
    for (let index = 1; index <= 2; index += 1) {
      const proposedAnswer = `Proposal ${index} for ${section}`;
      const created = structuredContent(await client.callTool({
        name: "create_alignment_question_card",
        arguments: {
          alignmentAttemptId: attemptId,
          idempotencyKey: `${args.keyPrefix}:${section}:${index}`,
          section,
          observation: `${section} ${index}`,
          question: `Question ${index} for ${section}?`,
          answerOptions: [
            proposedAnswer,
            `Alternative ${index} for ${section}`
          ],
          anchor
        }
      }));
      if (created.ok !== true) {
        throw new Error(
          `create_alignment_question_card(${section}/${index}) failed: ${JSON.stringify(created)}`
        );
      }
      const record = created.record as {
        id: string;
        answer_options: Array<{ id: string; text: string }>;
      };
      cards[section].push({
        id: String(record.id),
        answer: proposedAnswer,
        optionId: record.answer_options[0].id
      });
    }
  }

  const finalized = structuredContent(await client.callTool({
    name: "finalize_alignment_preparation",
    arguments: { alignmentAttemptId: attemptId }
  }));
  if (finalized.ok !== true) {
    throw new Error(
      `finalize_alignment_preparation failed: ${JSON.stringify(finalized)}`
    );
  }
  return { attemptId, annotationIds, cards };
}
