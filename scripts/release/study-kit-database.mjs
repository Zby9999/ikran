export function clearPrefilledAlignmentAnswers(db) {
  const result = db.prepare(`
    UPDATE alignment_question_cards
    SET proposed_answer = NULL
    WHERE proposed_answer IS NOT NULL
  `).run();
  return Number(result.changes);
}
