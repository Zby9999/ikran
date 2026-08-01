// Unit tests for design-system open-question answer write-back (Issue
// 09C-B03). The Atlas card's Open Questions panel lets the designer answer
// an extraction-open question: the question moves from value.openQuestions
// to value.openQuestionAnswers in BOTH the JSON source file (canonical
// serialization) and the DB row, with a semantic event and Browser
// invalidation. Status, links and meaning never change; answering never
// promotes the answer into a rule (that is Issue 12's rule-update flow).

import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";

import { recordSourceArtifact } from "../../lib/runtime/source-artifact";
import { answerDesignSystemOpenQuestion } from "../../lib/runtime/design-system-open-question";
import { initializeProjectDb } from "../../lib/runtime/db";
import { getProjectDbPath } from "../../lib/runtime/paths";
import { listEvents } from "../../lib/runtime/events";
import {
  resetRecordBusForTests,
  subscribeRecordEvents,
  type RecordBusEvent
} from "../../lib/runtime/record-bus";
import { registerSeedReference } from "../../lib/runtime/seed-reference";
import { recordEvidencePackage } from "../../lib/runtime/evidence-package";

const VALID_FIGMA = "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";
const LAYOUT_PATH = "design-system/layout-rules.json";

function withTempProject(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-ds-oq-"));
  try {
    initializeProjectDb(dir);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

afterEach(() => {
  resetRecordBusForTests();
});

function insertCard(
  dir: string,
  opts: { id: string; finalAnswer?: string | null; answerSource?: string | null }
) {
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    db.prepare(
      `INSERT INTO alignment_question_cards
       (id, section, observation, question, final_answer, answer_source,
        anchor_json, created_at, updated_at)
       VALUES (?, 'layout', 'obs', 'ques', ?, ?, '{}',
               '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z')`
    ).run(opts.id, opts.finalAnswer ?? null, opts.answerSource ?? null);
  } finally {
    db.close();
  }
}

function layoutFixture() {
  return {
    rules: [
      {
        id: "layout.gallery",
        value: {
          gap: "20px",
          relationship: ["项目图片组成横向溢出画廊。"],
          acceptanceChecks: ["保持横向溢出浏览。"],
          openQuestions: ["窄屏是否必须支持触控横向滚动？", "是否禁止自动轮播？"]
        },
        meaning: "项目图条以右侧裁切提示横向浏览。",
        status: "candidate",
        links: ["card-1"]
      }
    ]
  };
}

function seedAndIngest(dir: string) {
  // Declaration links require an answered card (09A decision 4); the seed +
  // evidence surface keeps the fixture discipline identical to the ingest /
  // approval tests.
  insertCard(dir, {
    id: "card-1",
    finalAnswer: "横向画廊确认",
    answerSource: "designer-edited"
  });
  const seed = registerSeedReference(dir, {
    figmaSeedReference: VALID_FIGMA,
    originalDesignIntent: "oq fixture"
  });
  if (!seed.ok) throw new Error(`seed failed: ${seed.reason}`);
  const pkg = recordEvidencePackage(dir, {
    figmaSeedReference: VALID_FIGMA,
    frame: { nodeId: "1:2", name: "Checkout" },
    evidenceViews: { rawData: "available", screenshot: "missing" }
  });
  if (!pkg.ok) throw new Error(`evidence failed: ${pkg.reason}`);

  const abs = path.join(dir, LAYOUT_PATH);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(layoutFixture()));
  const res = recordSourceArtifact(dir, {
    path: LAYOUT_PATH,
    artifactType: "layout-rules.json",
    semanticPurpose: "09C-B03 fixture",
    relatedRecordIds: ["card-1"]
  });
  if (!res.ok) throw new Error(`declare failed: ${res.reason}`);
}

function entryRow(dir: string) {
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    return db
      .prepare(
        `SELECT * FROM design_system_entries
         WHERE source_artifact_path = ? AND entry_id = ?`
      )
      .get(LAYOUT_PATH, "layout.gallery") as Record<string, unknown> | undefined;
  } finally {
    db.close();
  }
}

const INPUT = {
  sourceArtifactPath: LAYOUT_PATH,
  entryId: "layout.gallery",
  question: "窄屏是否必须支持触控横向滚动？",
  answer: "必须支持，移动端以触控滑动为主"
};

describe("answerDesignSystemOpenQuestion", () => {
  test("moves the question into openQuestionAnswers in BOTH file and DB, logging the event", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      const busEvents: RecordBusEvent[] = [];
      subscribeRecordEvents((event) => busEvents.push(event));

      const result = answerDesignSystemOpenQuestion(dir, INPUT);
      expect(result.ok).toBe(true);

      // Source file: canonical write-back moved the question.
      const file = JSON.parse(readFileSync(path.join(dir, LAYOUT_PATH), "utf-8"));
      const value = file.rules[0].value;
      expect(value.openQuestions).toEqual(["是否禁止自动轮播？"]);
      expect(value.openQuestionAnswers).toEqual([
        { question: INPUT.question, answer: INPUT.answer }
      ]);
      // Untouched fields survive verbatim.
      expect(value.gap).toBe("20px");
      expect(value.relationship).toEqual(["项目图片组成横向溢出画廊。"]);
      expect(file.rules[0].status).toBe("candidate");
      expect(file.rules[0].links).toEqual(["card-1"]);

      // DB row mirrors the file (the Browser reads the DB, not the file).
      const row = entryRow(dir);
      const dbValue = JSON.parse(row!.value_json as string);
      expect(dbValue.openQuestions).toEqual(["是否禁止自动轮播？"]);
      expect(dbValue.openQuestionAnswers).toEqual([
        { question: INPUT.question, answer: INPUT.answer }
      ]);
      expect(row!.status).toBe("candidate");

      // Semantic event + Browser invalidation.
      const events = listEvents(dir, "design_system_open_question_answered");
      expect(events).toHaveLength(1);
      expect(busEvents.some((e) => e.kind === "design-system")).toBe(true);
    });
  });

  test("rejects a question that is not open, leaving both sides untouched", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      const before = readFileSync(path.join(dir, LAYOUT_PATH), "utf-8");
      const result = answerDesignSystemOpenQuestion(dir, {
        ...INPUT,
        question: "不存在的问题？"
      });
      expect(result).toEqual({ ok: false, reason: "question_not_open" });
      expect(readFileSync(path.join(dir, LAYOUT_PATH), "utf-8")).toBe(before);
    });
  });

  test("rejects an empty answer without any write", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      const before = readFileSync(path.join(dir, LAYOUT_PATH), "utf-8");
      const result = answerDesignSystemOpenQuestion(dir, {
        ...INPUT,
        answer: "   "
      });
      expect(result).toEqual({ ok: false, reason: "missing_answer" });
      expect(readFileSync(path.join(dir, LAYOUT_PATH), "utf-8")).toBe(before);
    });
  });

  test("rejects an unknown entry", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      const result = answerDesignSystemOpenQuestion(dir, {
        ...INPUT,
        entryId: "layout.nope"
      });
      expect(result).toEqual({ ok: false, reason: "not_found" });
    });
  });

  test("a concurrent file writer aborts the write with concurrent_modification, leaving both sides consistent", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      const abs = path.join(dir, LAYOUT_PATH);
      // Simulate the winner landing between our read and our write: the
      // winner answered the OTHER question in the file only.
      const winner = layoutFixture();
      winner.rules[0]!.value.openQuestions = ["窄屏是否必须支持触控横向滚动？"];
      (winner.rules[0]!.value as Record<string, unknown>).openQuestionAnswers = [
        { question: "是否禁止自动轮播？", answer: "禁止。" }
      ];
      const result = answerDesignSystemOpenQuestion(dir, INPUT, {
        beforeWrite: () => {
          writeFileSync(abs, JSON.stringify(winner));
        }
      });
      expect(result).toEqual({ ok: false, reason: "concurrent_modification" });
      // The winner's file is untouched by the loser.
      const file = JSON.parse(readFileSync(abs, "utf-8"));
      expect(file.rules[0].value.openQuestions).toEqual([
        "窄屏是否必须支持触控横向滚动？"
      ]);
      expect(file.rules[0].value.openQuestionAnswers).toEqual([
        { question: "是否禁止自动轮播？", answer: "禁止。" }
      ]);
      // And the DB was never written by the loser — no fork.
      const row = entryRow(dir);
      const dbValue = JSON.parse(row!.value_json as string);
      expect(dbValue.openQuestions).toHaveLength(2);
      expect(dbValue.openQuestionAnswers ?? []).toEqual([]);
    });
  });

  test("answering the same question twice fails the second time (LWW guard)", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      const first = answerDesignSystemOpenQuestion(dir, INPUT);
      expect(first.ok).toBe(true);
      const second = answerDesignSystemOpenQuestion(dir, INPUT);
      expect(second).toEqual({ ok: false, reason: "question_not_open" });
      // Exactly one answer recorded on both sides.
      const file = JSON.parse(readFileSync(path.join(dir, LAYOUT_PATH), "utf-8"));
      expect(file.rules[0].value.openQuestionAnswers).toHaveLength(1);
      const row = entryRow(dir);
      expect(
        JSON.parse(row!.value_json as string).openQuestionAnswers
      ).toHaveLength(1);
    });
  });

  test("DB drift (question no longer open in the DB) restores the file", () => {
    withTempProject((dir) => {
      seedAndIngest(dir);
      // Simulate a concurrent writer that already answered in the DB only.
      const row = entryRow(dir)!;
      const drifted = JSON.parse(row.value_json as string);
      drifted.openQuestions = drifted.openQuestions.filter(
        (q: string) => q !== INPUT.question
      );
      const db = new DatabaseSync(getProjectDbPath(dir));
      try {
        db.prepare(
          `UPDATE design_system_entries SET value_json = ?
           WHERE source_artifact_path = ? AND entry_id = ?`
        ).run(JSON.stringify(drifted), LAYOUT_PATH, "layout.gallery");
      } finally {
        db.close();
      }

      const before = readFileSync(path.join(dir, LAYOUT_PATH), "utf-8");
      const result = answerDesignSystemOpenQuestion(dir, INPUT);
      expect(result).toEqual({ ok: false, reason: "question_not_open" });
      // The phase-2 file write was rolled back.
      expect(readFileSync(path.join(dir, LAYOUT_PATH), "utf-8")).toBe(before);
    });
  });
});
