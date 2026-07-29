"use client";

// Issue 08A — exact designer-annotation card height via an offscreen DOM
// probe. The pure estimator (CJK-aware unit count) still misses on mixed
// scripts, word-boundary wrapping and real font metrics; the probe reuses the
// card's own classes inside the tldraw container, so it measures with the
// identical font family, padding and wrapping the rendered card will have.
// Stacking and connector geometry then inherit the same exact height.

import {
  DESIGNER_ANNOTATION_CARD_MAX_H,
  DESIGNER_ANNOTATION_CARD_MIN_H,
  DESIGNER_ANNOTATION_CARD_W
} from "./designer-annotation-card-projection";

const probeByContainer = new WeakMap<HTMLElement, HTMLDivElement>();

function probeFor(container: HTMLElement): HTMLDivElement {
  const cached = probeByContainer.get(container);
  if (cached && cached.isConnected) return cached;
  const probe = document.createElement("div");
  probe.className = "designer-annotation-card";
  probe.setAttribute("aria-hidden", "true");
  // Inline overrides: real card width, auto height (the class pins 100%),
  // parked offscreen and invisible but still laid out.
  probe.style.cssText = `position:absolute;left:-10000px;top:0;width:${DESIGNER_ANNOTATION_CARD_W}px;height:auto;visibility:hidden;pointer-events:none;`;
  const body = document.createElement("p");
  body.className = "designer-annotation-card__body";
  probe.appendChild(body);
  container.appendChild(probe);
  probeByContainer.set(container, probe);
  return probe;
}

/** Rendered card height for `body`, clamped to the card's min/max. */
export function measureDesignerAnnotationCardHeight(
  container: HTMLElement,
  body: string
): number {
  const probe = probeFor(container);
  const bodyEl = probe.firstElementChild as HTMLElement | null;
  if (!bodyEl) return DESIGNER_ANNOTATION_CARD_MIN_H;
  bodyEl.textContent = body;
  const measured = probe.offsetHeight;
  // jsdom and detached layouts report 0 — fall back to the minimum rather
  // than trusting a meaningless measurement.
  if (measured <= 0) return DESIGNER_ANNOTATION_CARD_MIN_H;
  return Math.min(
    DESIGNER_ANNOTATION_CARD_MAX_H,
    Math.max(DESIGNER_ANNOTATION_CARD_MIN_H, measured)
  );
}
