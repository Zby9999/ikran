// Unit tests for design-system status 3-tier cross-validation (Issue 09 /
// 09A decision 4, Task B). Statuses are verified by Runtime against answered
// question cards / Agent annotations — never self-reported by the Agent.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, expect } from "vitest";
import {
  loadDesignSystemLinkIndex,
  checkDesignSystemEntryStatus,
  checkDesignSystemDeclarationLinksOnDb,
  type DesignSystemLinkIndex
} from "../../lib/runtime/design-system-status";
import { recordSourceArtifact } from "../../lib/runtime/source-artifact";
import { listEvents } from "../../lib/runtime/events";
import { initializeProjectDb, openProjectDb, closeProjectDb } from "../../lib/runtime/db";
import { getProjectDbPath } from "../../lib/runtime/paths";

function withTempProject(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-ds-status-"));
  try {
    initializeProjectDb(dir);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
       VALUES (?, 'token', 'obs', 'ques', ?, ?,
               '{}', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z')`
    ).run(opts.id, opts.finalAnswer ?? null, opts.answerSource ?? null);
  } finally {
    db.close();
  }
}

function insertAnnotation(
  dir: string,
  opts: { id: string; inference: string }
) {
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    db.prepare(
      `INSERT INTO agent_alignment_annotations
       (id, inference, body, anchor_json, created_at, updated_at)
       VALUES (?, ?, 'body', '{}',
               '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z')`
    ).run(opts.id, opts.inference);
  } finally {
    db.close();
  }
}

function writeTokenJson(dir: string) {
  const abs = path.join(dir, "design-system", "token.json");
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(
    abs,
    JSON.stringify({ primitive: {}, semantic: {}, component: {} })
  );
}

function tokenDeclaration(overrides: Record<string, unknown> = {}) {
  return {
    path: "design-system/token.json",
    artifactType: "token.json",
    semanticPurpose: "token layers",
    ...overrides
  };
}

function indexOf(entries: {
  answeredCards?: Record<string, string>;
  annotations?: Record<string, string>;
}): DesignSystemLinkIndex {
  return {
    answeredCards: new Map(
      Object.entries(entries.answeredCards ?? {})
    ) as DesignSystemLinkIndex["answeredCards"],
    annotations: new Map(
      Object.entries(entries.annotations ?? {})
    ) as DesignSystemLinkIndex["annotations"]
  };
}

// ---------------------------------------------------------------------------
// loadDesignSystemLinkIndex
// ---------------------------------------------------------------------------

test.describe("loadDesignSystemLinkIndex", () => {
  test("answered cards (any source) + annotations load; unanswered cards excluded", () => {
    withTempProject((dir) => {
      insertCard(dir, {
        id: "card-edited",
        finalAnswer: "设计师改过的答案",
        answerSource: "designer-edited"
      });
      insertCard(dir, {
        id: "card-accepted",
        finalAnswer: "采纳 Agent 提议",
        answerSource: "agent-proposed-designer-accepted"
      });
      insertCard(dir, { id: "card-open", finalAnswer: null });
      insertCard(dir, { id: "card-blank", finalAnswer: "   " });
      insertAnnotation(dir, { id: "ann-reasonable", inference: "reasonable" });
      insertAnnotation(dir, { id: "ann-confirmed", inference: "confirmed" });

      const db = openProjectDb(dir);
      try {
        const index = loadDesignSystemLinkIndex(db);
        expect(index.answeredCards.get("card-edited")).toBe("designer-edited");
        expect(index.answeredCards.get("card-accepted")).toBe(
          "agent-proposed-designer-accepted"
        );
        expect(index.answeredCards.has("card-open")).toBe(false);
        expect(index.answeredCards.has("card-blank")).toBe(false);
        expect(index.annotations.get("ann-reasonable")).toBe("reasonable");
        expect(index.annotations.get("ann-confirmed")).toBe("confirmed");
      } finally {
        closeProjectDb(db);
      }
    });
  });

  test("annotations with non-candidate-grade inference are excluded; a candidate backed only by one is rejected", () => {
    withTempProject((dir) => {
      insertAnnotation(dir, { id: "ann-wild", inference: "wild-guess" });

      const db = openProjectDb(dir);
      try {
        const index = loadDesignSystemLinkIndex(db);
        expect(index.annotations.has("ann-wild")).toBe(false);

        const res = checkDesignSystemEntryStatus(
          { status: "candidate", links: ["ann-wild"] },
          index
        );
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.reason).toBe(
          "candidate_requires_answered_card_or_reasonable_annotation"
        );
      } finally {
        closeProjectDb(db);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// checkDesignSystemEntryStatus (pure, pre-fetched index)
// ---------------------------------------------------------------------------

test.describe("checkDesignSystemEntryStatus", () => {
  const index = indexOf({
    answeredCards: {
      "card-edited": "designer-edited",
      "card-accepted": "agent-proposed-designer-accepted"
    },
    annotations: {
      "ann-reasonable": "reasonable",
      "ann-confirmed": "confirmed"
    }
  });

  test("formalized + designer-edited answered card → ok", () => {
    const res = checkDesignSystemEntryStatus(
      { status: "formalized", links: ["card-edited"] },
      index
    );
    expect(res.ok).toBe(true);
  });

  test("formalized + mix of spoofed and genuine links → ok (one designer-edited suffices)", () => {
    const res = checkDesignSystemEntryStatus(
      { status: "formalized", links: ["unknown", "ann-reasonable", "card-edited"] },
      index
    );
    expect(res.ok).toBe(true);
  });

  test("formalized without designer-edited link → rejected", () => {
    const cases: string[][] = [
      [], // no links at all
      ["card-accepted"], // answered but only agent-proposed-designer-accepted
      ["ann-reasonable"], // annotation is not a designer answer
      ["ann-confirmed"],
      ["unknown-card"], // forged id
      ["card-accepted", "ann-reasonable", "unknown"]
    ];
    for (const links of cases) {
      const res = checkDesignSystemEntryStatus(
        { status: "formalized", links },
        index
      );
      expect(res.ok, JSON.stringify(links)).toBe(false);
      if (res.ok) continue;
      expect(res.reason).toBe("formalized_requires_designer_edited_link");
    }
  });

  test("candidate + answered card (any source) → ok", () => {
    for (const links of [["card-edited"], ["card-accepted"]]) {
      const res = checkDesignSystemEntryStatus(
        { status: "candidate", links },
        index
      );
      expect(res.ok, JSON.stringify(links)).toBe(true);
    }
  });

  test("candidate + reasonable / confirmed annotation → ok", () => {
    for (const links of [["ann-reasonable"], ["ann-confirmed"]]) {
      const res = checkDesignSystemEntryStatus(
        { status: "candidate", links },
        index
      );
      expect(res.ok, JSON.stringify(links)).toBe(true);
    }
  });

  test("candidate with nothing linkable → rejected", () => {
    for (const links of [[], ["unknown"], ["unknown", "also-unknown"]]) {
      const res = checkDesignSystemEntryStatus(
        { status: "candidate", links },
        index
      );
      expect(res.ok, JSON.stringify(links)).toBe(false);
      if (res.ok) continue;
      expect(res.reason).toBe(
        "candidate_requires_answered_card_or_reasonable_annotation"
      );
    }
  });

  test("candidate + unanswered card only → rejected", () => {
    const withUnanswered = indexOf({
      answeredCards: {},
      annotations: {}
    });
    const res = checkDesignSystemEntryStatus(
      { status: "candidate", links: ["card-open"] },
      withUnanswered
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe(
      "candidate_requires_answered_card_or_reasonable_annotation"
    );
  });

  test("gap with no links → ok; gap with links → gap_must_not_link", () => {
    const ok = checkDesignSystemEntryStatus({ status: "gap", links: [] }, index);
    expect(ok.ok).toBe(true);

    const bad = checkDesignSystemEntryStatus(
      { status: "gap", links: ["card-edited"] },
      index
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.reason).toBe("gap_must_not_link");
  });
});

// ---------------------------------------------------------------------------
// Declaration-time link requirement (09A decision 4: declarations link
// answered question cards and/or Agent annotations) — DB-dependent check
// inside the declaration transaction.
// ---------------------------------------------------------------------------

test.describe("checkDesignSystemDeclarationLinksOnDb", () => {
  test("empty links → unlinked_design_system_artifact", () => {
    withTempProject((dir) => {
      const db = openProjectDb(dir);
      try {
        const res = checkDesignSystemDeclarationLinksOnDb(db, []);
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.reason).toBe("unlinked_design_system_artifact");
      } finally {
        closeProjectDb(db);
      }
    });
  });

  test("unknown / unanswered card → link_not_answered_card_or_annotation", () => {
    withTempProject((dir) => {
      insertCard(dir, { id: "card-open", finalAnswer: null });
      const db = openProjectDb(dir);
      try {
        for (const ids of [["unknown"], [["card-open"]][0]]) {
          const res = checkDesignSystemDeclarationLinksOnDb(db, ids);
          expect(res.ok, JSON.stringify(ids)).toBe(false);
          if (res.ok) continue;
          expect(res.reason).toBe("link_not_answered_card_or_annotation");
        }
      } finally {
        closeProjectDb(db);
      }
    });
  });

  test("answered card (any source) → ok", () => {
    withTempProject((dir) => {
      insertCard(dir, {
        id: "card-accepted",
        finalAnswer: "采纳",
        answerSource: "agent-proposed-designer-accepted"
      });
      const db = openProjectDb(dir);
      try {
        const res = checkDesignSystemDeclarationLinksOnDb(db, ["card-accepted"]);
        expect(res.ok).toBe(true);
      } finally {
        closeProjectDb(db);
      }
    });
  });

  test("existing Agent annotation id → ok (09A decision 4)", () => {
    withTempProject((dir) => {
      insertAnnotation(dir, { id: "ann-1", inference: "reasonable" });
      const db = openProjectDb(dir);
      try {
        const res = checkDesignSystemDeclarationLinksOnDb(db, ["ann-1"]);
        expect(res.ok).toBe(true);
      } finally {
        closeProjectDb(db);
      }
    });
  });
});

test.describe("recordSourceArtifact link requirement", () => {
  test("design-system declaration without links → rejected + invalid_artifact, no row", () => {
    withTempProject((dir) => {
      writeTokenJson(dir);
      const res = recordSourceArtifact(dir, tokenDeclaration());
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("unlinked_design_system_artifact");

      const invalid = listEvents(dir, "invalid_artifact");
      expect(invalid.length).toBe(1);
      expect(invalid[0].payload).toMatchObject({
        tool: "record_artifact_written",
        reason: "unlinked_design_system_artifact",
        details: { path: "design-system/token.json" }
      });
      expect(listEvents(dir, "source_artifact_declared").length).toBe(0);
    });
  });

  test("design-system declaration linking unknown card → link_not_answered_card_or_annotation", () => {
    withTempProject((dir) => {
      writeTokenJson(dir);
      const res = recordSourceArtifact(
        dir,
        tokenDeclaration({ relatedRecordIds: ["forged-card"] })
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("link_not_answered_card_or_annotation");
      expect(listEvents(dir, "invalid_artifact").length).toBe(1);
    });
  });

  test("design-system declaration linking answered card → declared", () => {
    withTempProject((dir) => {
      insertCard(dir, {
        id: "card-1",
        finalAnswer: "答",
        answerSource: "designer-edited"
      });
      writeTokenJson(dir);
      const res = recordSourceArtifact(
        dir,
        tokenDeclaration({ relatedRecordIds: ["card-1"] })
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(JSON.parse(res.record.related_record_ids_json)).toEqual(["card-1"]);
    });
  });

  test("design-system declaration linking an Agent annotation → declared", () => {
    withTempProject((dir) => {
      insertAnnotation(dir, { id: "ann-1", inference: "reasonable" });
      writeTokenJson(dir);
      const res = recordSourceArtifact(
        dir,
        tokenDeclaration({ relatedRecordIds: ["ann-1"] })
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(JSON.parse(res.record.related_record_ids_json)).toEqual(["ann-1"]);
    });
  });

  test("prototype/code declarations are NOT subject to the link requirement", () => {
    withTempProject((dir) => {
      const abs = path.join(dir, "prototype", "app.tsx");
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, "export default function App() {}");
      const res = recordSourceArtifact(dir, {
        path: "prototype/app.tsx",
        artifactType: "prototype",
        semanticPurpose: "reconstruction draft"
      });
      expect(res.ok).toBe(true);
    });
  });
});
