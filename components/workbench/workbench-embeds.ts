// Workbench embed allowlist. Runtime-owned Prototype Evidence Surfaces may use
// tldraw embeds; Figma URLs are Runtime-owned Seed capture instead.

import {
  DEFAULT_EMBED_DEFINITIONS,
  type TLEmbedDefinition
} from "tldraw";
import {
  extractFigmaDesignUrl,
  isFigmaDesignUrl
} from "../../lib/runtime/figma-identity";

export { extractFigmaDesignUrl, isFigmaDesignUrl };

/** Runtime projections may embed supported previews; Figma never becomes an iframe. */
export const WORKBENCH_EMBED_DEFINITIONS: TLEmbedDefinition[] =
  DEFAULT_EMBED_DEFINITIONS.filter((definition) => definition.type !== "figma");

/** True when clipboard mentions figma.com but is not a design/file selection URL. */
export function isMalformedFigmaPaste(text: string): boolean {
  if (!/(?:^|[\s(/])(?:www\.)?figma\.com\b/i.test(text) && !/https?:\/\/(?:www\.)?figma\.com/i.test(text)) {
    return false;
  }
  return extractFigmaDesignUrl(text) == null;
}

/** True when a tldraw embed shape points at Figma (legacy coexistence cleanup). */
export function isFigmaEmbedUrl(url: unknown): boolean {
  return typeof url === "string" && /(?:^|[/.])figma\.com\b/i.test(url);
}
