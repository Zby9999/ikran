// Post-declaration acceptance for component live heroes
// (verify_component_live_heroes).
//
// declare_component_live_heroes is metadata-only: it validates codeLinks,
// declared artifacts and surface readiness, but never loads the harness
// route. The only geometry check lived in the Workbench client
// (heroLiveVerdictReducer), which neither the Runtime nor the Agent can see
// — so a broken harness (e.g. a wrong relative import making the dev server
// answer 500) was declared "live" and only a human opening the Browser
// discovered the heroes had fallen back to unavailable.
//
// This module closes the loop: for every component spec with a liveHero
// declaration, Runtime loads <previewUrl><harnessPath> — the default document
// plus each declared stateMatrix state — inside a sandboxed iframe in
// headless Chromium and waits for the exact v2 `ikran:component-size` report
// the Workbench expects. A plain HTTP preflight distinguishes "the route
// itself errors" (dev-server 500: wrong import, missing file) from "the page
// loads but never reports geometry" (sizing helper missing/misinstalled).
//
// Nothing is written: this is an observation tool. `playwright-core` is
// imported dynamically like in rule-capture.ts, and all host effects go
// through LiveHeroVerifyDeps so unit tests run without a browser. Never
// throws: failures resolve with typed reasons.

import { closeProjectDb, openProjectDb } from "./db";
import { getPrototypeSurface } from "./prototype-surface";
import { PROTOTYPE_PRESENTATION_VIEWPORT_WIDTH } from "./prototype-screenshot-shared";

export interface VerifyComponentLiveHeroesInput {
  /** Restrict verification to these component spec entries (row id or
   * entry_id). Absent verifies every component spec with a liveHero. */
  entryIds?: readonly string[];
  /** Per-navigation geometry wait budget. Cold dev-server compiles can
   * exceed the Workbench's 5s hero timeout, so the default is higher. */
  timeoutMs?: number;
  /** Internal/default-first orchestration scope. Omit for legacy all-state behavior. */
  states?: readonly string[];
}

export const LIVE_HERO_VERIFY_DEFAULT_TIMEOUT_MS = 10_000;
export const LIVE_HERO_VERIFY_MIN_TIMEOUT_MS = 1_000;
export const LIVE_HERO_VERIFY_MAX_TIMEOUT_MS = 60_000;
const LIVE_HERO_MAX_REPORTED_EXTENT = 16_384;
const HTTP_PREFLIGHT_TIMEOUT_MS = 10_000;

export interface LiveHeroVerifyBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LiveHeroVerifyUrlResult =
  | { state: string; url: string; ok: true; bounds: LiveHeroVerifyBounds }
  | {
      state: string;
      url: string;
      ok: false;
      reason:
        | "preview_unreachable"
        | "http_error"
        | "geometry_timeout"
        | "invalid_geometry";
      /** HTTP status when the harness document itself answered an error. */
      status?: number;
      details?: unknown;
    };

export type LiveHeroVerifyEntryResult = {
  entry_id: string;
  harness_url: string | null;
  ok: boolean;
  skipped?:
    | "entry_not_found"
    | "no_live_hero"
    | "surface_not_found"
    | "surface_not_ready"
    | "surface_stale";
  results: LiveHeroVerifyUrlResult[];
};

export type VerifyComponentLiveHeroesResult =
  | {
      ok: true;
      all_passed: boolean;
      entries: LiveHeroVerifyEntryResult[];
    }
  | {
      ok: false;
      reason: "invalid_input" | "browser_unavailable" | "db_error";
      details?: unknown;
    };

/** Minimal page surface used by the verifier. `loadHarnessAndAwaitReport`
 * points the verifier iframe at `url` and resolves with the first report
 * whose href matches exactly, or null on timeout — one method so unit tests
 * fake the seam without emulating evaluate/waitForFunction plumbing. */
export interface LiveHeroVerifyPage {
  setContent(html: string): Promise<unknown>;
  loadHarnessAndAwaitReport(
    url: string,
    timeoutMs: number
  ): Promise<unknown>;
}

export interface LiveHeroVerifyBrowser {
  newPage(): Promise<LiveHeroVerifyPage>;
  close(): Promise<unknown>;
}

/** Structural minimum of a Playwright Page the default bridge uses. */
interface PlaywrightPageLike {
  setContent(html: string): Promise<unknown>;
  evaluate(fn: unknown, arg?: unknown): Promise<unknown>;
  waitForFunction(
    fn: unknown,
    arg: unknown,
    options: { timeout: number }
  ): Promise<unknown>;
}

function playwrightVerifyPage(page: PlaywrightPageLike): LiveHeroVerifyPage {
  return {
    setContent: (html) => page.setContent(html),
    async loadHarnessAndAwaitReport(url, timeoutMs) {
      await page.evaluate((target: string) => {
        const w = window as unknown as { __ikranReports?: unknown[] };
        w.__ikranReports = [];
        const frame = document.getElementById("harness");
        if (frame !== null) frame.setAttribute("src", target);
      }, url);
      try {
        await page.waitForFunction(
          (expected: string) => {
            const w = window as unknown as {
              __ikranReports?: Array<{ href?: unknown }>;
            };
            return (w.__ikranReports ?? []).some(
              (report) => report.href === expected
            );
          },
          url,
          { timeout: timeoutMs }
        );
      } catch {
        return null;
      }
      const reports = (await page.evaluate((expected: string) => {
        const w = window as unknown as {
          __ikranReports?: Array<Record<string, unknown>>;
        };
        return (w.__ikranReports ?? []).filter(
          (report) => report.href === expected
        );
      }, url)) as Array<Record<string, unknown>>;
      return reports[0] ?? null;
    }
  };
}

export interface LiveHeroVerifyDeps {
  /** Launch a headless browser; may reject when Playwright is unavailable. */
  launchBrowser(): Promise<LiveHeroVerifyBrowser>;
  /** Plain HTTP preflight of the harness document; ok:false means the
   * preview server could not be reached at all. */
  fetchStatus(
    url: string
  ): Promise<{ ok: true; status: number } | { ok: false }>;
}

export const defaultLiveHeroVerifyDeps: LiveHeroVerifyDeps = {
  async launchBrowser() {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ headless: true });
    return {
      newPage: async () => playwrightVerifyPage(await browser.newPage()),
      close: () => browser.close()
    };
  },
  async fetchStatus(url) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(HTTP_PREFLIGHT_TIMEOUT_MS),
        redirect: "follow"
      });
      // Drain so the connection can be reused/closed cleanly.
      await response.arrayBuffer().catch(() => undefined);
      return { ok: true, status: response.status };
    } catch {
      return { ok: false };
    }
  }
};

/** The parent-side listener mirrors the Workbench's acceptance rules: the
 * message must be v2, carry the exact current href, and the iframe keeps the
 * sandbox boundary the hero uses. Reports collect on window.__ikranReports. */
const VERIFIER_HTML = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script>
  window.__ikranReports = [];
  window.addEventListener("message", function (event) {
    var d = event.data;
    if (d && d.type === "ikran:component-size" && d.version === 2 && typeof d.href === "string") {
      window.__ikranReports.push({ href: d.href, x: d.x, y: d.y, width: d.width, height: d.height });
    }
  });
</script>
<iframe id="harness" sandbox="allow-scripts allow-same-origin"
  style="width:${PROTOTYPE_PRESENTATION_VIEWPORT_WIDTH}px;height:900px;border:0"></iframe>
</body></html>`;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Same acceptance rules as the Workbench's parseComponentHeroSizeMessage. */
function toValidBounds(value: unknown): LiveHeroVerifyBounds | null {
  if (!isPlainObject(value)) return null;
  const { x, y, width, height } = value;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > PROTOTYPE_PRESENTATION_VIEWPORT_WIDTH ||
    y + height > LIVE_HERO_MAX_REPORTED_EXTENT
  ) {
    return null;
  }
  return { x, y, width, height };
}

type LiveHeroDeclaration = {
  surfaceId: string;
  harnessPath: string;
};

type VerifyTarget = {
  entryId: string;
  liveHero: LiveHeroDeclaration;
  stateNames: string[];
};

type EntryRow = {
  id: string;
  entry_id: string;
  value_json: string;
};

function readLiveHero(value: unknown): LiveHeroDeclaration | null {
  if (!isPlainObject(value) || !isPlainObject(value.liveHero)) return null;
  const declaration = value.liveHero;
  if (
    typeof declaration.surfaceId !== "string" ||
    typeof declaration.harnessPath !== "string" ||
    declaration.surfaceId.trim().length === 0 ||
    declaration.harnessPath.trim().length === 0
  ) {
    return null;
  }
  return {
    surfaceId: declaration.surfaceId.trim(),
    harnessPath: declaration.harnessPath.trim()
  };
}

function readStateNames(value: unknown): string[] {
  if (!isPlainObject(value) || !Array.isArray(value.stateMatrix)) return [];
  const names: string[] = [];
  for (const row of value.stateMatrix) {
    if (!isPlainObject(row) || typeof row.state !== "string") continue;
    const name = row.state.trim();
    if (name.length === 0) continue;
    // A state named "default" is the no-query resting document — verifying
    // it would load the same URL twice (same normalization as the hero).
    if (name.toLowerCase() === "default") continue;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Collect the verification targets from the project DB. */
function collectTargets(
  projectPath: string,
  entryIds: readonly string[] | undefined
): { targets: VerifyTarget[]; missing: string[] } | { dbError: true } {
  let db;
  try {
    db = openProjectDb(projectPath);
  } catch {
    return { dbError: true };
  }
  try {
    const targets: VerifyTarget[] = [];
    const seen = new Set<string>();
    if (entryIds !== undefined && entryIds.length > 0) {
      const stmt = db.prepare(
        `SELECT id, entry_id, value_json FROM design_system_entries
         WHERE (id = ? OR entry_id = ?) AND file_kind = 'component-spec'`
      );
      const missing: string[] = [];
      for (const requested of entryIds) {
        const row = stmt.get(requested, requested) as EntryRow | undefined;
        if (!row) {
          missing.push(requested);
          continue;
        }
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        let value: unknown;
        try {
          value = JSON.parse(row.value_json) as unknown;
        } catch {
          continue;
        }
        const liveHero = readLiveHero(value);
        targets.push({
          entryId: row.entry_id,
          liveHero: liveHero ?? { surfaceId: "", harnessPath: "" },
          stateNames: readStateNames(value)
        });
      }
      return { targets, missing };
    }
    const rows = db
      .prepare(
        `SELECT id, entry_id, value_json FROM design_system_entries
         WHERE file_kind = 'component-spec'`
      )
      .all() as EntryRow[];
    for (const row of rows) {
      let value: unknown;
      try {
        value = JSON.parse(row.value_json) as unknown;
      } catch {
        continue;
      }
      const liveHero = readLiveHero(value);
      if (liveHero === null) continue;
      targets.push({
        entryId: row.entry_id,
        liveHero,
        stateNames: readStateNames(value)
      });
    }
    return { targets, missing: [] };
  } catch {
    return { dbError: true };
  } finally {
    closeProjectDb(db);
  }
}

async function verifyUrl(
  page: LiveHeroVerifyPage,
  state: string,
  url: string,
  timeoutMs: number,
  deps: LiveHeroVerifyDeps
): Promise<LiveHeroVerifyUrlResult> {
  const preflight = await deps.fetchStatus(url);
  if (!preflight.ok) {
    return { state, url, ok: false, reason: "preview_unreachable" };
  }
  if (preflight.status >= 400) {
    return {
      state,
      url,
      ok: false,
      reason: "http_error",
      status: preflight.status
    };
  }
  const report = await page.loadHarnessAndAwaitReport(url, timeoutMs);
  if (report === null) {
    return { state, url, ok: false, reason: "geometry_timeout" };
  }
  const bounds = toValidBounds(report);
  if (bounds === null) {
    return {
      state,
      url,
      ok: false,
      reason: "invalid_geometry",
      details: { report }
    };
  }
  return { state, url, ok: true, bounds };
}

/**
 * Load every declared live hero harness and confirm it reports valid v2
 * geometry — for the default document and each declared state. Never throws;
 * per-URL failures are data, not exceptions.
 */
export async function verifyComponentLiveHeroes(
  projectPath: string,
  input: VerifyComponentLiveHeroesInput = {},
  deps: LiveHeroVerifyDeps = defaultLiveHeroVerifyDeps
): Promise<VerifyComponentLiveHeroesResult> {
  const timeoutMs =
    typeof input.timeoutMs === "number" &&
    Number.isFinite(input.timeoutMs) &&
    input.timeoutMs >= LIVE_HERO_VERIFY_MIN_TIMEOUT_MS &&
    input.timeoutMs <= LIVE_HERO_VERIFY_MAX_TIMEOUT_MS
      ? Math.floor(input.timeoutMs)
      : input.timeoutMs === undefined
        ? LIVE_HERO_VERIFY_DEFAULT_TIMEOUT_MS
        : -1;
  if (timeoutMs === -1) {
    return {
      ok: false,
      reason: "invalid_input",
      details: {
        timeoutMs: input.timeoutMs,
        min: LIVE_HERO_VERIFY_MIN_TIMEOUT_MS,
        max: LIVE_HERO_VERIFY_MAX_TIMEOUT_MS
      }
    };
  }

  const collected = collectTargets(projectPath, input.entryIds);
  if ("dbError" in collected) return { ok: false, reason: "db_error" };

  const entries: LiveHeroVerifyEntryResult[] = collected.missing.map(
    (entryId) => ({
      entry_id: entryId,
      harness_url: null,
      ok: false,
      skipped: "entry_not_found" as const,
      results: []
    })
  );

  // Resolve surfaces first; only entries with a live, non-stale preview pay
  // for the browser.
  type PlannedEntry = {
    target: VerifyTarget;
    baseUrl: string;
    urls: Array<{ state: string; url: string }>;
  };
  const planned: PlannedEntry[] = [];
  for (const target of collected.targets) {
    if (target.liveHero.harnessPath.length === 0) {
      entries.push({
        entry_id: target.entryId,
        harness_url: null,
        ok: false,
        skipped: "no_live_hero",
        results: []
      });
      continue;
    }
    const surface = getPrototypeSurface(projectPath, target.liveHero.surfaceId);
    if (surface === null) {
      entries.push({
        entry_id: target.entryId,
        harness_url: null,
        ok: false,
        skipped: "surface_not_found",
        results: []
      });
      continue;
    }
    const baseUrl = `${surface.preview_url}${target.liveHero.harnessPath}`;
    if (surface.readiness !== "ready" || surface.preview_url.trim().length === 0) {
      entries.push({
        entry_id: target.entryId,
        harness_url: baseUrl,
        ok: false,
        skipped: "surface_not_ready",
        results: []
      });
      continue;
    }
    if (surface.stale) {
      entries.push({
        entry_id: target.entryId,
        harness_url: baseUrl,
        ok: false,
        skipped: "surface_stale",
        results: []
      });
      continue;
    }
    planned.push({
      target,
      baseUrl,
      urls: [
        { state: "default", url: baseUrl },
        ...target.stateNames.map((state) => ({
          state,
          url: `${baseUrl}?state=${encodeURIComponent(state)}`
        }))
      ].filter(({ state }) =>
        input.states === undefined ? true : input.states.includes(state)
      )
    });
  }

  if (planned.length > 0) {
    let browser: LiveHeroVerifyBrowser;
    try {
      browser = await deps.launchBrowser();
    } catch {
      return { ok: false, reason: "browser_unavailable" };
    }
    try {
      const page = await browser.newPage();
      await page.setContent(VERIFIER_HTML);
      for (const entry of planned) {
        const results: LiveHeroVerifyUrlResult[] = [];
        for (const { state, url } of entry.urls) {
          results.push(await verifyUrl(page, state, url, timeoutMs, deps));
        }
        entries.push({
          entry_id: entry.target.entryId,
          harness_url: entry.baseUrl,
          ok: results.every((result) => result.ok),
          results
        });
      }
    } finally {
      try {
        await browser.close();
      } catch {
        // The browser is already gone — nothing to clean up.
      }
    }
  }

  const allPassed =
    entries.length > 0 && entries.every((entry) => entry.ok);
  return { ok: true, all_passed: allPassed, entries };
}
