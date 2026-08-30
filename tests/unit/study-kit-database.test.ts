import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";

import {
  applyCuratedStudyKitQuestionCards,
  clearPrefilledAlignmentAnswers,
  ensureStudyKitAlignmentCheckpoint
} from "../../scripts/release/study-kit-database.mjs";
import { questionCardsForStudyKit } from "../../scripts/release/study-kit-question-cards.mjs";
import {
  figmaReferenceForStudyKit,
  rewriteStudyKitFigmaReferenceText
} from "../../scripts/release/study-kit-figma-references.mjs";

describe("Study Kit database sanitization", () => {
  test("restores the incremental checkpoint for a frozen answering workspace", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE project_workflow (
          singleton INTEGER PRIMARY KEY,
          stage TEXT NOT NULL,
          current_alignment_attempt_id TEXT
        );
        CREATE TABLE alignment_attempts (id TEXT PRIMARY KEY, status TEXT NOT NULL);
        CREATE TABLE alignment_semantic_state (
          alignment_attempt_id TEXT PRIMARY KEY,
          current_revision INTEGER NOT NULL,
          frozen_revision INTEGER,
          frozen_digest TEXT,
          monitoring_status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE alignment_semantic_changes (
          alignment_attempt_id TEXT NOT NULL,
          revision INTEGER NOT NULL,
          source_kind TEXT NOT NULL,
          source_id TEXT NOT NULL,
          section TEXT NOT NULL,
          source_digest TEXT NOT NULL,
          operation TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (alignment_attempt_id, revision, source_kind, source_id)
        );
        CREATE TABLE alignment_question_cards (
          id TEXT PRIMARY KEY,
          alignment_attempt_id TEXT NOT NULL,
          section TEXT NOT NULL,
          observation TEXT NOT NULL,
          question TEXT NOT NULL,
          final_answer TEXT,
          answer_source TEXT,
          selected_option_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE agent_alignment_annotations (
          id TEXT PRIMARY KEY,
          alignment_attempt_id TEXT NOT NULL,
          section TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          inference TEXT NOT NULL,
          additional_information_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE region_annotations (
          id TEXT PRIMARY KEY,
          author TEXT NOT NULL,
          section TEXT,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO project_workflow VALUES (1, 'alignment-answering', 'attempt');
        INSERT INTO alignment_attempts VALUES ('attempt', 'answering');
        INSERT INTO alignment_question_cards VALUES
          ('question', 'attempt', 'design-concept', 'Priority', 'Which priority?',
           'Clarity', 'designer-custom', NULL, '2026-08-30T00:00:00.000Z');
        INSERT INTO agent_alignment_annotations VALUES
          ('agent-note', 'attempt', 'design-concept', 'Observation', 'Keep clarity.',
           'reasonable', '[]', '2026-08-30T00:00:00.000Z');
        INSERT INTO region_annotations VALUES
          ('designer-note', 'designer', 'design-concept', 'Preserve the voice.',
           '2026-08-30T00:00:00.000Z');
      `);

      expect(ensureStudyKitAlignmentCheckpoint(db)).toEqual({
        created: true,
        alignmentAttemptId: "attempt",
        semanticSourceCount: 3
      });
      expect(ensureStudyKitAlignmentCheckpoint(db)).toEqual({
        created: false,
        alignmentAttemptId: "attempt",
        semanticSourceCount: 3
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM alignment_semantic_state").get())
        .toEqual({ count: 1 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM alignment_semantic_changes").get())
        .toEqual({ count: 3 });
    } finally {
      db.close();
    }
  });

  test("moves Kit 1 to its current Figma node throughout frozen evidence text", () => {
    const old = "https://www.figma.com/design/zMbujZ9js5LsAXnOdtTAHG/ikran?node-id=1-2024&t=share-token-11";
    expect(rewriteStudyKitFigmaReferenceText(
      JSON.stringify({ url: old, frameNodeId: "1:2024", parentId: "1:2024" }),
      "kit-1"
    )).toBe(JSON.stringify({
      url: figmaReferenceForStudyKit("kit-1").url,
      frameNodeId: "99:71",
      parentId: "99:71"
    }));
  });

  test("canonicalizes Kit 2 without changing its still-current node", () => {
    const old = "https://www.figma.com/design/zMbujZ9js5LsAXnOdtTAHG/ikran?node-id=2-1721&t=share-token-11";
    expect(rewriteStudyKitFigmaReferenceText(old, "kit-2"))
      .toBe(figmaReferenceForStudyKit("kit-2").url);
  });

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
