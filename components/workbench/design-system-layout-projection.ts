// Design System Layout Source Capture projection (Issue 09C-D02).
//
// A deterministic derivation from DB-backed layout rule rows into the pieces
// the Source Capture placard stream renders: a human-readable headline, the
// spatial measurements recognized from the rule value (verbatim source
// labels, alias-aware — never invented facts), and the Figma node captures
// the Runtime view decorated onto the entry. Rules with no captures surface
// as honest unavailable blocks instead of fabricated visuals.
//
// Every projected rule keeps its canonical `row` so status, the ⓘ evidence
// popover and candidate approval stay wired to the DB entry.

import { formatRuleBody } from "./design-system-reader-projection";
import type {
  DesignSystemLayoutCapture,
  LayoutCaptureNodeRect
} from "@/lib/runtime/design-system-view";
import type { DsRow } from "./design-system-view-model";

/* ------------------------------- v2 display ------------------------------- */

/** A node occupying at least this much of the capture area IS the picture —
 * framing it again would be noise, so the position mark is skipped. */
const NODE_MARK_FILL_THRESHOLD = 0.85;

/** Fixed-ratio figure orientation (v2): 3:2 landscape for wide nodes, 2:3
 * portrait for tall ones. Derived from the declared nodeRect (the node's
 * own shape); legacy captures without one default to landscape. */
export function captureOrientation(
  capture: DesignSystemLayoutCapture
): "landscape" | "portrait" {
  const rect = capture.nodeRect;
  if (rect == null) return "landscape";
  return rect.width >= rect.height ? "landscape" : "portrait";
}

/** The hairline position mark's rect, or null when no mark should render —
 * either undeclared (legacy capture) or the node nearly fills the image. */
export function captureNodeMark(
  capture: DesignSystemLayoutCapture
): LayoutCaptureNodeRect | null {
  const rect = capture.nodeRect;
  if (rect == null) return null;
  return rect.width * rect.height < NODE_MARK_FILL_THRESHOLD ? rect : null;
}

/* --------------------------------- model --------------------------------- */

export interface LayoutRuleProjection {
  row: DsRow;
  /** Display headline: the rule's human-readable claim (meaning), with the
   * concern name as the fallback when no meaning was written. */
  headline: string;
  /** Verbatim prose body, or generic readable fallback for legacy objects. */
  body: string;
  /** The rule's source key ("grid.page") — identity, not display. */
  concern: string;
  /** Node captures decorated by the Runtime view ([] when undeclared). */
  captures: DesignSystemLayoutCapture[];
}

export interface LayoutLeafModel {
  rules: LayoutRuleProjection[];
}

function projectRule(row: DsRow): LayoutRuleProjection {
  const value = row.entry.value;
  return {
    row,
    headline: row.meaning.trim() !== "" ? row.meaning : row.name,
    body: formatRuleBody(value),
    concern: row.name,
    captures: row.entry.captures ?? []
  };
}

/**
 * Whole-leaf derivation. Rules keep source order; each rule's own `captures`
 * decides whether it shows a source visual or the honest unavailable block.
 */
export function projectLayoutLeaf(rows: readonly DsRow[]): LayoutLeafModel {
  return { rules: rows.map((row) => projectRule(row)) };
}
