import { createHash } from "node:crypto";

function sourceDigest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function ensureStudyKitAlignmentCheckpoint(db) {
  const active = db.prepare(`
    SELECT w.current_alignment_attempt_id AS alignment_attempt_id
    FROM project_workflow w
    JOIN alignment_attempts a ON a.id = w.current_alignment_attempt_id
    WHERE w.singleton = 1
      AND w.stage = 'alignment-answering'
      AND a.status = 'answering'
  `).get();
  if (!active) {
    throw new Error("Study Kit must contain an active answering attempt");
  }
  const countSources = () => Number(Object.values(db.prepare(`
    SELECT COUNT(*) AS count
    FROM alignment_semantic_changes
    WHERE alignment_attempt_id = ?
  `).get(active.alignment_attempt_id) ?? { count: 0 })[0] ?? 0);
  const existing = db.prepare(`
    SELECT 1 AS present
    FROM alignment_semantic_state
    WHERE alignment_attempt_id = ?
  `).get(active.alignment_attempt_id);
  if (existing) {
    return {
      created: false,
      alignmentAttemptId: active.alignment_attempt_id,
      semanticSourceCount: countSources()
    };
  }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO alignment_semantic_state
      (alignment_attempt_id, current_revision, frozen_revision, frozen_digest,
       monitoring_status, created_at, updated_at)
    VALUES (?, 1, NULL, NULL, 'paused', ?, ?)
  `).run(active.alignment_attempt_id, now, now);
  const insert = db.prepare(`
    INSERT INTO alignment_semantic_changes
      (alignment_attempt_id, revision, source_kind, source_id, section,
       source_digest, operation, created_at)
    VALUES (?, 1, ?, ?, ?, ?, 'upsert', ?)
  `);

  const questions = db.prepare(`
    SELECT id, section, observation, question, final_answer, answer_source,
           selected_option_id
    FROM alignment_question_cards
    WHERE alignment_attempt_id = ?
      AND final_answer IS NOT NULL AND TRIM(final_answer) <> ''
    ORDER BY created_at ASC, id ASC
  `).all(active.alignment_attempt_id);
  for (const row of questions) {
    const value = {
      sourceId: row.id,
      kind: "question",
      section: row.section,
      title: row.observation,
      question: row.question,
      answer: row.final_answer,
      answerSource: row.answer_source,
      selectedOptionId: row.selected_option_id
    };
    insert.run(
      active.alignment_attempt_id,
      value.kind,
      value.sourceId,
      value.section,
      sourceDigest(value),
      now
    );
  }

  const agentAnnotations = db.prepare(`
    SELECT id, section, title, body, inference, additional_information_json
    FROM agent_alignment_annotations
    WHERE alignment_attempt_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(active.alignment_attempt_id);
  for (const row of agentAnnotations) {
    const value = {
      sourceId: row.id,
      kind: "agent-annotation",
      section: row.section,
      title: row.title,
      statement: row.body,
      confidence: row.inference,
      additionalInformation: JSON.parse(row.additional_information_json)
    };
    insert.run(
      active.alignment_attempt_id,
      value.kind,
      value.sourceId,
      value.section,
      sourceDigest(value),
      now
    );
  }

  const designerAnnotations = db.prepare(`
    SELECT id, section, body
    FROM region_annotations
    WHERE author = 'designer' AND section IS NOT NULL
    ORDER BY created_at ASC, id ASC
  `).all();
  for (const row of designerAnnotations) {
    const value = {
      sourceId: row.id,
      kind: "designer-annotation",
      section: row.section,
      statement: row.body
    };
    insert.run(
      active.alignment_attempt_id,
      value.kind,
      value.sourceId,
      value.section,
      sourceDigest(value),
      now
    );
  }

  return {
    created: true,
    alignmentAttemptId: active.alignment_attempt_id,
    semanticSourceCount: countSources()
  };
}

export function clearPrefilledAlignmentAnswers(db) {
  const result = db.prepare(`
    UPDATE alignment_question_cards
    SET proposed_answer = NULL
    WHERE proposed_answer IS NOT NULL
  `).run();
  return Number(result.changes);
}

export function applyCuratedStudyKitQuestionCards(db, kitId, cards) {
  if (!Array.isArray(cards) || cards.length !== 16) {
    throw new Error(`${kitId} must define exactly 16 curated Question cards`);
  }

  const columns = new Set(
    db.prepare("PRAGMA table_info(alignment_question_cards)").all()
      .map((column) => String(column.name))
  );
  if (!columns.has("answer_options_json")) {
    db.exec("ALTER TABLE alignment_question_cards ADD COLUMN answer_options_json TEXT;");
  }
  if (!columns.has("selected_option_id")) {
    db.exec("ALTER TABLE alignment_question_cards ADD COLUMN selected_option_id TEXT;");
  }

  const rows = db.prepare(`
    SELECT id, section, observation
    FROM alignment_question_cards
    WHERE alignment_attempt_id = (
      SELECT current_alignment_attempt_id
      FROM project_workflow
      WHERE singleton = 1
    )
    ORDER BY created_at, id
  `).all();
  if (rows.length !== cards.length) {
    throw new Error(
      `${kitId} has ${rows.length} current Question cards; expected ${cards.length}`
    );
  }

  const update = db.prepare(`
    UPDATE alignment_question_cards
    SET question = ?, answer_options_json = ?, selected_option_id = NULL
    WHERE id = ?
  `);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const card = cards[index];
    if (row.section !== card.section || row.observation !== card.observation) {
      throw new Error(
        `${kitId} Question card ${index + 1} changed: expected ` +
        `${card.section}/${card.observation}, received ${row.section}/${row.observation}`
      );
    }
    const question = String(card.question ?? "").trim();
    const answerOptions = Array.isArray(card.answerOptions)
      ? card.answerOptions.map((option) => String(option).trim())
      : [];
    if (!question || answerOptions.length < 2 || answerOptions.some((option) => !option)) {
      throw new Error(`${kitId} Question card ${index + 1} has invalid copy or options`);
    }
    if (new Set(answerOptions).size !== answerOptions.length) {
      throw new Error(`${kitId} Question card ${index + 1} repeats an answer option`);
    }
    update.run(
      question,
      JSON.stringify(answerOptions.map((text, optionIndex) => ({
        id: `${row.id}:option:${optionIndex + 1}`,
        text
      }))),
      row.id
    );
  }
  return rows.length;
}
