// Unit tests for Design System Browser preferences persistence (project-local
// `.ikran/design-system-browser.json`). Plain last-write-wins split-ratio
// state: shared parse/clamp rules, Node read/write, and the command wrappers.

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  DEFAULT_DS_SPLIT_RATIO,
  DESIGN_SYSTEM_BROWSER_PREFERENCES_VERSION,
  emptyDesignSystemBrowserPreferences,
  parseDesignSystemBrowserPreferences
} from "../../lib/runtime/design-system-browser-preferences-shared";
import {
  readDesignSystemBrowserPreferences,
  writeDesignSystemBrowserPreferences
} from "../../lib/runtime/design-system-browser-preferences";
import {
  getDesignSystemBrowserPreferencesCommand,
  putDesignSystemBrowserPreferencesCommand
} from "../../lib/runtime/commands";
import {
  getDesignSystemBrowserPreferencesPath,
  getIkranDir
} from "../../lib/runtime/paths";

function withTempProject(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-dsb-preferences-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Preferences writes require an initialized `.ikran` dir (bound project). */
function initIkranDir(dir: string) {
  mkdirSync(getIkranDir(dir), { recursive: true });
}

// ---------------------------------------------------------------------------
// Pure parse (client-safe shared module)
// ---------------------------------------------------------------------------

describe("parseDesignSystemBrowserPreferences", () => {
  test("empty preferences carry the default split ratio", () => {
    expect(emptyDesignSystemBrowserPreferences()).toEqual({
      version: DESIGN_SYSTEM_BROWSER_PREFERENCES_VERSION,
      splitRatio: DEFAULT_DS_SPLIT_RATIO
    });
  });

  test("valid document round-trips, preserving version", () => {
    expect(
      parseDesignSystemBrowserPreferences({ version: 3, splitRatio: 0.5 })
    ).toEqual({ version: 3, splitRatio: 0.5 });
  });

  test("missing version falls back to the current version", () => {
    expect(parseDesignSystemBrowserPreferences({ splitRatio: 0.5 })).toEqual({
      version: DESIGN_SYSTEM_BROWSER_PREFERENCES_VERSION,
      splitRatio: 0.5
    });
  });

  test("out-of-range ratios are clamped into [0.1, 0.9], not rejected", () => {
    expect(
      parseDesignSystemBrowserPreferences({ splitRatio: 0.05 })?.splitRatio
    ).toBe(0.1);
    expect(
      parseDesignSystemBrowserPreferences({ splitRatio: 0.95 })?.splitRatio
    ).toBe(0.9);
  });

  test("non-number / missing splitRatio and non-objects are rejected", () => {
    expect(parseDesignSystemBrowserPreferences(null)).toBeNull();
    expect(parseDesignSystemBrowserPreferences("garbage")).toBeNull();
    expect(parseDesignSystemBrowserPreferences({})).toBeNull();
    expect(
      parseDesignSystemBrowserPreferences({ splitRatio: "0.5" })
    ).toBeNull();
    expect(
      parseDesignSystemBrowserPreferences({ splitRatio: NaN })
    ).toBeNull();
    expect(
      parseDesignSystemBrowserPreferences({ splitRatio: Infinity })
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Node read
// ---------------------------------------------------------------------------

describe("readDesignSystemBrowserPreferences", () => {
  test("missing file yields defaults without writing anything", () => {
    withTempProject((dir) => {
      initIkranDir(dir);
      const result = readDesignSystemBrowserPreferences(dir);
      expect(result).toEqual({
        ok: true,
        preferences: emptyDesignSystemBrowserPreferences()
      });
      expect(existsSync(getDesignSystemBrowserPreferencesPath(dir))).toBe(
        false
      );
    });
  });

  test("corrupt JSON file → read_failed", () => {
    withTempProject((dir) => {
      initIkranDir(dir);
      writeFileSync(getDesignSystemBrowserPreferencesPath(dir), "{not json");
      const result = readDesignSystemBrowserPreferences(dir);
      expect(result).toEqual({ ok: false, reason: "read_failed" });
    });
  });

  test("valid JSON with an invalid shape → read_failed", () => {
    withTempProject((dir) => {
      initIkranDir(dir);
      writeFileSync(
        getDesignSystemBrowserPreferencesPath(dir),
        JSON.stringify({ splitRatio: "wide" })
      );
      const result = readDesignSystemBrowserPreferences(dir);
      expect(result).toEqual({ ok: false, reason: "read_failed" });
    });
  });
});

// ---------------------------------------------------------------------------
// Node write (+ read round-trip)
// ---------------------------------------------------------------------------

describe("writeDesignSystemBrowserPreferences", () => {
  test("write + read round-trips { version, splitRatio } canonically", () => {
    withTempProject((dir) => {
      initIkranDir(dir);
      const written = writeDesignSystemBrowserPreferences(dir, {
        version: 1,
        splitRatio: 0.66
      });
      expect(written).toEqual({
        ok: true,
        preferences: { version: 1, splitRatio: 0.66 }
      });

      const read = readDesignSystemBrowserPreferences(dir);
      expect(read).toEqual({
        ok: true,
        preferences: { version: 1, splitRatio: 0.66 }
      });

      // Canonical serialization: 2-space JSON, single trailing newline.
      const content = readFileSync(
        getDesignSystemBrowserPreferencesPath(dir),
        "utf8"
      );
      expect(content).toBe(
        `${JSON.stringify({ version: 1, splitRatio: 0.66 }, null, 2)}\n`
      );
    });
  });

  test("write clamps an out-of-range ratio before persisting", () => {
    withTempProject((dir) => {
      initIkranDir(dir);
      const result = writeDesignSystemBrowserPreferences(dir, {
        splitRatio: 0.95
      });
      expect(result).toEqual({
        ok: true,
        preferences: {
          version: DESIGN_SYSTEM_BROWSER_PREFERENCES_VERSION,
          splitRatio: 0.9
        }
      });
    });
  });

  test("project without an .ikran dir → write_failed", () => {
    withTempProject((dir) => {
      const result = writeDesignSystemBrowserPreferences(dir, {
        splitRatio: 0.5
      });
      expect(result).toEqual({ ok: false, reason: "write_failed" });
    });
  });

  test("invalid input → invalid_preferences, nothing written", () => {
    withTempProject((dir) => {
      initIkranDir(dir);
      const result = writeDesignSystemBrowserPreferences(dir, {
        splitRatio: "wide"
      });
      expect(result).toEqual({ ok: false, reason: "invalid_preferences" });
      expect(existsSync(getDesignSystemBrowserPreferencesPath(dir))).toBe(
        false
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Command wrappers
// ---------------------------------------------------------------------------

describe("preferences command wrappers", () => {
  test("get returns defaults for a fresh project", () => {
    withTempProject((dir) => {
      initIkranDir(dir);
      expect(getDesignSystemBrowserPreferencesCommand(dir)).toEqual({
        ok: true,
        preferences: emptyDesignSystemBrowserPreferences()
      });
    });
  });

  test("put then get round-trips the same shape", () => {
    withTempProject((dir) => {
      initIkranDir(dir);
      expect(
        putDesignSystemBrowserPreferencesCommand(dir, { splitRatio: 0.3 })
      ).toEqual({
        ok: true,
        preferences: {
          version: DESIGN_SYSTEM_BROWSER_PREFERENCES_VERSION,
          splitRatio: 0.3
        }
      });
      expect(getDesignSystemBrowserPreferencesCommand(dir)).toEqual({
        ok: true,
        preferences: {
          version: DESIGN_SYSTEM_BROWSER_PREFERENCES_VERSION,
          splitRatio: 0.3
        }
      });
    });
  });

  test("put rejects invalid input with invalid_preferences", () => {
    withTempProject((dir) => {
      initIkranDir(dir);
      expect(putDesignSystemBrowserPreferencesCommand(dir, null)).toEqual({
        ok: false,
        reason: "invalid_preferences"
      });
    });
  });
});
