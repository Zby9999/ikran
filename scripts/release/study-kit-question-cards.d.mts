import type { StudyKitQuestionCard } from "./study-kit-database.mjs";

export const STUDY_KIT_QUESTION_CARDS: Readonly<
  Record<"kit-1" | "kit-2", readonly StudyKitQuestionCard[]>
>;

export function questionCardsForStudyKit(
  kitId: string
): readonly StudyKitQuestionCard[];
