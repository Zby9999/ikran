// Client-safe Design System Browser preferences types + pure helpers (no Node / SQLite).
// Server I/O lives in `design-system-browser-preferences.ts`.

export const DESIGN_SYSTEM_BROWSER_PREFERENCES_VERSION = 1;

export const DEFAULT_DS_SPLIT_RATIO = 0.42;

export interface DesignSystemBrowserPreferencesDocument {
  version: number;
  splitRatio: number;
}

export type DesignSystemBrowserPreferencesErrorReason =
  | "read_failed"
  | "write_failed"
  | "invalid_preferences";

// Split-pane ratio bounds — both panes must stay usable.
const MIN_SPLIT_RATIO = 0.1;
const MAX_SPLIT_RATIO = 0.9;

export function emptyDesignSystemBrowserPreferences(): DesignSystemBrowserPreferencesDocument {
  return {
    version: DESIGN_SYSTEM_BROWSER_PREFERENCES_VERSION,
    splitRatio: DEFAULT_DS_SPLIT_RATIO
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Parse and normalize a preferences document. Out-of-range ratios are clamped
 * into [0.1, 0.9] rather than rejected; non-numeric input is rejected.
 */
export function parseDesignSystemBrowserPreferences(
  raw: unknown
): DesignSystemBrowserPreferencesDocument | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isFiniteNumber(o.splitRatio)) return null;

  return {
    version: isFiniteNumber(o.version)
      ? o.version
      : DESIGN_SYSTEM_BROWSER_PREFERENCES_VERSION,
    splitRatio: Math.min(
      MAX_SPLIT_RATIO,
      Math.max(MIN_SPLIT_RATIO, o.splitRatio)
    )
  };
}
