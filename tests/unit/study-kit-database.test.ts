import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";

import {
  applyCuratedStudyKitQuestionCards,
  clearPrefilledAlignmentAnswers
} from "../../scripts/release/study-kit-database.mjs";
import { questionCardsForStudyKit } from "../../scripts/release/study-kit-question-cards.mjs";

describe("Study Kit database sanitization", () => {
  test("removes proposed answers from every attempt without changing final answers", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE alignment_question_cards (
          id TEXT PRIMARY KEY,
          alignment_attempt_id TEXT NOT NULL,
          proposed_answer TEXT,
          final_answer TEXT
        );
        INSERT INTO alignment_question_cards
          (id, alignment_attempt_id, proposed_answer, final_answer)
        VALUES
          ('current-1', 'current', 'A proposed answer', NULL),
          ('current-2', 'current', '', NULL),
          ('abandoned-1', 'abandoned', 'An older proposed answer', 'A retained answer'),
          ('abandoned-2', 'abandoned', NULL, NULL);
      `);

      expect(clearPrefilledAlignmentAnswers(db)).toBe(3);

      const rows = db.prepare(`
        SELECT id, proposed_answer, final_answer
        FROM alignment_question_cards
        ORDER BY id
      `).all();
      expect(rows).toEqual([
        { id: "abandoned-1", proposed_answer: null, final_answer: "A retained answer" },
        { id: "abandoned-2", proposed_answer: null, final_answer: null },
        { id: "current-1", proposed_answer: null, final_answer: null },
        { id: "current-2", proposed_answer: null, final_answer: null }
      ]);
    } finally {
      db.close();
    }
  });

  test.each(["kit-1", "kit-2"])(
    "installs the curated questions and ordered multi-options for %s",
    (kitId) => {
      const db = new DatabaseSync(":memory:");
      const cards = questionCardsForStudyKit(kitId);
      try {
        db.exec(`
          CREATE TABLE project_workflow (
            singleton INTEGER PRIMARY KEY,
            current_alignment_attempt_id TEXT
          );
          INSERT INTO project_workflow VALUES (1, 'current');
          CREATE TABLE alignment_question_cards (
            id TEXT PRIMARY KEY,
            alignment_attempt_id TEXT NOT NULL,
            section TEXT NOT NULL,
            observation TEXT NOT NULL,
            question TEXT NOT NULL,
            proposed_answer TEXT,
            final_answer TEXT,
            created_at TEXT NOT NULL
          );
        `);
        const insert = db.prepare(`
          INSERT INTO alignment_question_cards
            (id, alignment_attempt_id, section, observation, question,
             proposed_answer, final_answer, created_at)
          VALUES (?, 'current', ?, ?, 'Legacy question?', NULL, NULL, ?)
        `);
        cards.forEach((card, index) => {
          insert.run(
            `card-${index + 1}`,
            card.section,
            card.observation,
            `2026-08-30T00:00:${String(index).padStart(2, "0")}.000Z`
          );
        });

        expect(applyCuratedStudyKitQuestionCards(db, kitId, cards)).toBe(16);
        const rows = db.prepare(`
          SELECT id, question, answer_options_json, selected_option_id
          FROM alignment_question_cards
          ORDER BY created_at, id
        `).all() as Array<{
          id: string;
          question: string;
          answer_options_json: string;
          selected_option_id: string | null;
        }>;
        expect(rows).toHaveLength(16);
        rows.forEach((row, index) => {
          expect(row.question).toBe(cards[index]!.question);
          expect(row.selected_option_id).toBeNull();
          expect(JSON.parse(row.answer_options_json)).toEqual(
            cards[index]!.answerOptions.map((text, optionIndex) => ({
              id: `${row.id}:option:${optionIndex + 1}`,
              text
            }))
          );
        });
      } finally {
        db.close();
      }
    }
  );
});
