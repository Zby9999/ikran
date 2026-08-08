import { z } from "zod";

import {
  reconcileDesignerConversation,
  type ReconcileDesignerConversationInput,
  type ReconcileDesignerConversationResult
} from "../conversation-reconciliation";

const conversationMessageSchema = z.object({
  id: z.string().describe("Stable Agent-host message id."),
  role: z.enum(["designer", "agent"]),
  content: z.string().describe("Verbatim message content from the bounded transcript.")
});

const conversationDecisionSchema = z.object({
  summary: z.string().describe("One decision derived from the bounded transcript."),
  disposition: z.enum([
    "final_decision",
    "superseded",
    "local_exception",
    "open_gap"
  ]),
  sourceMessageIds: z
    .array(z.string())
    .min(1)
    .describe("Transcript message ids supporting this decision; at least one must be designer-authored."),
  evidenceSurfaceId: z.string().optional(),
  prototypeSurfaceId: z.string().optional(),
  regionAnnotationId: z.string().optional(),
  seedReferenceId: z.string().optional(),
  opaqueContext: z.unknown().optional()
});

export const reconcileDesignerConversationInputShape = {
  reviewId: z
    .string()
    .describe("Stable idempotency id; reuse it when an interrupted completion turn resumes."),
  conversationId: z.string().describe("Stable Agent-host conversation id."),
  runId: z.string().describe("Prototype/design run represented by this conversation."),
  sessionId: z.string().describe("Design session represented by this review."),
  startMessageId: z.string().describe("First message id in the frozen review range."),
  endMessageId: z.string().describe("Last message id in the frozen review range."),
  messages: z
    .array(conversationMessageSchema)
    .min(1)
    .describe("Complete, ordered, verbatim transcript snapshot for the frozen range."),
  decisions: z
    .array(conversationDecisionSchema)
    .describe("Complete decision ledger; use an empty array when the review found no decisions.")
} as const;

export const reconcileDesignerConversationInputSchema = z.object(
  reconcileDesignerConversationInputShape
);

export function reconcileDesignerConversationCommand(
  projectPath: string,
  input: ReconcileDesignerConversationInput
): ReconcileDesignerConversationResult {
  return reconcileDesignerConversation(projectPath, input);
}
