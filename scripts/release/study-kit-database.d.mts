import type { DatabaseSync } from "node:sqlite";

export function ensureStudyKitAlignmentCheckpoint(db: DatabaseSync): {
  created: boolean;
  alignmentAttemptId: string;
  semanticSourceCount: number;
};

export function clearPrefilledAlignmentAnswers(db: DatabaseSync): number;

export type StudyKitQuestionCard = Readonly<{
  section: string;
  observation: string;
  question: string;
  answerOptions: readonly string[];
}>;

export function applyCuratedStudyKitQuestionCards(
  db: DatabaseSync,
  kitId: string,
  cards: readonly StudyKitQuestionCard[]
): number;
