import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";

import { clearPrefilledAlignmentAnswers } from "../../scripts/release/study-kit-database.mjs";

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
});
