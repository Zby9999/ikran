// Design System Layout Atlas projection (Issue 09C-B03).
//
// A deterministic derivation from DB-backed layout rule rows into the card
// view models the Atlas leaf renders: short name, meaning, structured-fact
// badges, collapsed rich-field lines, open/answered questions, and the
// per-rule spatial facts the card's own schematic draws. It never invents a
// design fact: badge labels are verbatim source values (alias-aware), Q&A
// lists tolerate malformed entries, and rules without spatial values are
// marked not-drawable so the card can say so honestly instead of fabricating
// a drawing.
//
// The spatial facts reuse the 09C-B Blueprint recognition (same vocabulary,
// same "lineage is not geometry" exclusion) so a measurement means the same
// thing in both views. Every card keeps its canonical `row` so status, the
// ⓘ evidence popover, open-question answering and candidate approval stay
// wired to the DB entry.

import {
  projectLayoutBlueprint,
  type LayoutSpatialFact
} from "./design-system-layout-projection";
import {
  aliasTargetOf,
  formatValueField
} from "./design-system-reader-projection";
import type { DsRow } from "./design-system-view-model";

/*
 * GENERATIVE UI RULE (09C-B03, locked by the designer): the Atlas is a
 * generative visual system, not a one-off page for the current data. Every
 * future extraction must render through the SAME minimal schematic style,
 * so stability comes from constraints, not from per-project tuning:
 *   1. The badge vocabulary is open (any scalar key), but the schematic
 *      vocabulary is CLOSED — only the 09C-B spatial fact kinds draw.
 *   2. No per-rule, per-project, or per-design-system special cases:
 *      the same projection + renderer serve every extraction.
 *   3. Unknown content degrades honestly (badges skip it, schematic
 *      shows the placeholder), never a best-effort guess.
 */

export interface LayoutAtlasBadge {
  key: string;
  /** Verbatim source display ("20px", "→ spacing.200", "navigation · content"). */
  label: string;
}

export interface LayoutAtlasAnswered {
  question: string;
  answer: string;
}

export interface LayoutAtlasCard {
  row: DsRow;
  /** Stable 1-based position in source order. */
  anchor: number;
  /** Short display name: entry id without the "layout." prefix. */
  name: string;
  meaning: string;
  badges: LayoutAtlasBadge[];
  /** relationship lines — shown as the quiet constraint line. */
  constraintLines: string[];
  /** Collapsed detail: responsiveBehavior / acceptanceChecks / tokenLinks. */
  responsiveLines: string[];
  acceptanceChecks: string[];
  tokenLinks: string[];
  openQuestions: string[];
  answeredQuestions: LayoutAtlasAnswered[];
  /** Drawable spatial facts for the card's own schematic (09C-B vocabulary). */
  schematicFacts: LayoutSpatialFact[];
  drawable: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Rich metadata + Q&A keys describe lineage and conversation, never badges. */
const NON_BADGE_KEYS = new Set([
  "relationship",
  "responsiveBehavior",
  "tokenLinks",
  "acceptanceChecks",
  "openQuestions",
  "openQuestionAnswers"
]);

function stringListOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim() !== ""
  );
}

function answeredListOf(value: unknown): LayoutAtlasAnswered[] {
  if (!Array.isArray(value)) return [];
  const answered: LayoutAtlasAnswered[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const { question, answer } = item;
    if (
      typeof question === "string" &&
      question.trim() !== "" &&
      typeof answer === "string" &&
      answer.trim() !== ""
    ) {
      answered.push({ question, answer });
    }
  }
  return answered;
}

/**
 * Badge extraction: scalar keys and string-array keys become badges in
 * source order; rich metadata, Q&A and unrecognized composites do not.
 * Labels are verbatim source values so the card never paraphrases the rule.
 */
function badgesFromValue(value: Record<string, unknown>): LayoutAtlasBadge[] {
  const badges: LayoutAtlasBadge[] = [];
  for (const [key, field] of Object.entries(value)) {
    if (NON_BADGE_KEYS.has(key)) continue;
    if (typeof field === "string" || typeof field === "number") {
      badges.push({ key, label: formatValueField(field) });
      continue;
    }
    if (aliasTargetOf(field) !== null) {
      badges.push({ key, label: formatValueField(field) });
      continue;
    }
    if (Array.isArray(field)) {
      const parts = field.filter(
        (item): item is string => typeof item === "string" && item.trim() !== ""
      );
      if (parts.length === field.length && parts.length > 0) {
        badges.push({ key, label: parts.join(" · ") });
      }
    }
  }
  return badges;
}

function shortName(row: DsRow): string {
  const id = row.entryId;
  if (id.startsWith("layout.")) return id.slice("layout.".length);
  return row.name ?? id;
}

/**
 * Whole-leaf derivation. Cards keep source order; anchors are 1-based
 * positions matching the Blueprint's anchor numbering.
 */
export function projectLayoutAtlasCards(
  rows: readonly DsRow[]
): LayoutAtlasCard[] {
  const blueprint = projectLayoutBlueprint(rows);
  return rows.map((row, index) => {
    const spatial = blueprint.rules[index];
    const value = row.entry.value;
    const object =
      isPlainObject(value) && row.entry.alias === null ? value : null;
    return {
      row,
      anchor: index + 1,
      name: shortName(row),
      meaning: row.meaning,
      badges: object ? badgesFromValue(object) : [],
      constraintLines: object ? stringListOf(object.relationship) : [],
      responsiveLines: object ? stringListOf(object.responsiveBehavior) : [],
      acceptanceChecks: object ? stringListOf(object.acceptanceChecks) : [],
      tokenLinks: object ? stringListOf(object.tokenLinks) : [],
      openQuestions: object ? stringListOf(object.openQuestions) : [],
      answeredQuestions: object
        ? answeredListOf(object.openQuestionAnswers)
        : [],
      schematicFacts: spatial?.facts ?? [],
      drawable: (spatial?.facts.length ?? 0) > 0
    };
  });
}
