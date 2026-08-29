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
