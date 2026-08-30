import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";

import { initializeProjectDb } from "../../lib/runtime/db";
import { declareComponentLiveHeroes } from "../../lib/runtime/design-system-live-hero";
import {
  firstValidLiveHeroReport,
  verifyComponentLiveHeroes,
  type LiveHeroVerifyBrowser,
  type LiveHeroVerifyDeps
} from "../../lib/runtime/live-hero-verify";
import { getProjectDbPath } from "../../lib/runtime/paths";
import { resetRecordBusForTests } from "../../lib/runtime/record-bus";

const dirs: string[] = [];

function projectDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-live-hero-verify-"));
  dirs.push(dir);
  initializeProjectDb(dir);
  return dir;
}

afterEach(() => {
  resetRecordBusForTests();
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function writeProjectFile(dir: string, relative: string, content: string) {
  const absolute = path.join(dir, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

/** Mirrors the design-system-live-hero fixture: one formalized component
 * spec with codeLinks, declared code + harness artifacts, and a ready
 * prototype surface. */
function seed(
  dir: string,
  options?: { stateMatrix?: unknown[]; harnessPath?: string }
) {
  const specPath = "design-system/components/button.json";
  const codePath = "prototype/components/Button.tsx";
  const harnessArtifactPath =
    "prototype/app/__ikran/component/button/page.tsx";
  const value = {
    description: "Button",
    props: [],
    variants: [],
    stateMatrix: options?.stateMatrix ?? [
      { state: "hover" },
      // A state literally named "default" is the resting document; the
      // verifier must not load the same URL twice.
      { state: "default" }
    ],
    guidelines: [],
    tokenLinks: [],
    codeLinks: [codePath],
    sourceCaptures: []
  };
  writeProjectFile(dir, codePath, "export const Button = () => <button />;");
  writeProjectFile(
    dir,
    harnessArtifactPath,
    "export default function Page() { return null; }"
  );
  writeProjectFile(
    dir,
    specPath,
    `${JSON.stringify({
      id: "component.button",
      name: "Button",
      meaning: "Button",
      status: "formalized",
      links: ["card-1"],
      value
    })}\n`
  );

  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    const now = "2026-08-18T00:00:00.000Z";
    db.prepare(
      `INSERT INTO design_system_entries
       (id, source_artifact_path, file_kind, section, entry_id, name,
        value_json, meaning, status, links_json, source_captures_json,
        position, created_at, updated_at)
       VALUES ('row-button', ?, 'component-spec', 'components.spec',
               'component.button', 'Button', ?, 'Button', 'formalized',
               '["card-1"]', '[]', 0, ?, ?)`
    ).run(specPath, JSON.stringify(value), now, now);
    const artifact = db.prepare(
      `INSERT INTO source_artifacts
       (id, path, artifact_type, semantic_purpose, related_record_ids_json,
        readiness, declaration_version, status, created_at, updated_at)
       VALUES (?, ?, ?, 'fixture', '[]', 'ready', 1, 'ingested', ?, ?)`
    );
    artifact.run("artifact-code", codePath, "code", now, now);
    artifact.run("artifact-harness", harnessArtifactPath, "prototype", now, now);
    db.prepare(
      `INSERT INTO prototype_runs
       (id, run_id, source_artifact_path, prototype_root, dev_command,
        seed_reference_ids_json, evidence_version_ids_json,
        design_system_version, created_at, updated_at,
        kind, intent, used_candidate_ids_json)
       VALUES ('run-row', 'run-1', ?, 'prototype', 'npm run dev', '[]', '[]',
               'ds-v1', ?, ?, 'seed_reconstruction', NULL, '[]')`
    ).run(codePath, now, now);
    db.prepare(
      `INSERT INTO prototype_surfaces
       (id, prototype_run_id, surface_key, name, preview_url, preview_port,
        readiness, readiness_reason, stale, stale_reason, created_at, updated_at)
       VALUES ('surface-1', 'run-row', 'landing', 'Landing',
               'http://127.0.0.1:4300', 4300, 'ready', NULL, ?, ?, ?, ?)`
    ).run(0, null, now, now);
  } finally {
    db.close();
  }

  const declared = declareComponentLiveHeroes(dir, [
    {
      entryId: "component.button",
      surfaceId: "surface-1",
      harnessPath: options?.harnessPath ?? "/__ikran/component/button",
      harnessArtifactPath
    }
  ]);
  if (!declared.ok) throw new Error(`fixture declare failed: ${declared.reason}`);
}

const BASE_URL = "http://127.0.0.1:4300/__ikran/component/button";
const VALID_REPORT = {
  href: "",
  x: 0,
  y: 0,
  width: 120,
  height: 40
};

test("a transient zero-size report does not win over the first valid geometry", () => {
  const href = "http://127.0.0.1:4300/ikran-component-preview.html?registrationId=text";
  expect(
    firstValidLiveHeroReport(
      [
        { href, x: 0, y: 0, width: 0, height: 0 },
        { href, x: 0, y: 0, width: 84, height: 24 }
      ],
      href
    )
  ).toEqual({ href, x: 0, y: 0, width: 84, height: 24 });
});

type Script = Record<
  string,
  { report?: Record<string, unknown> | null; status?: number; unreachable?: boolean }
>;

function fakeDeps(
  script: Script,
  navigations: string[],
  launchTracker?: { called: boolean }
): LiveHeroVerifyDeps {
  const browser: LiveHeroVerifyBrowser = {
    newPage: async () => ({
      setContent: async () => {},
      loadHarnessAndAwaitReport: async (url: string) => {
        navigations.push(url);
        const entry = script[url];
        if (!entry || entry.report === undefined) return null;
        return entry.report;
      }
    }),
    close: async () => {}
  };
  return {
    launchBrowser: async () => {
      if (launchTracker) launchTracker.called = true;
      return browser;
    },
    fetchStatus: async (url) => {
      const entry = script[url];
      if (entry?.unreachable) return { ok: false };
      return { ok: true, status: entry?.status ?? 200 };
    }
  };
}

test("verifies default and declared states; a 'default' state is not loaded twice", async () => {
  const dir = projectDir();
  seed(dir);
  const navigations: string[] = [];
  const script: Script = {
    [BASE_URL]: { report: { ...VALID_REPORT, href: BASE_URL } },
    [`${BASE_URL}?state=hover`]: {
      report: { ...VALID_REPORT, href: `${BASE_URL}?state=hover` }
    }
  };
  const result = await verifyComponentLiveHeroes(
    dir,
    {},
    fakeDeps(script, navigations)
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.all_passed).toBe(true);
  expect(result.entries).toHaveLength(1);
  const entry = result.entries[0]!;
  expect(entry.entry_id).toBe("component.button");
  expect(entry.harness_url).toBe(BASE_URL);
  expect(entry.results.map((r) => r.state)).toEqual(["default", "hover"]);
  expect(entry.results.every((r) => r.ok)).toBe(true);
  // No request was made for the state literally named "default".
  expect(navigations).toEqual([BASE_URL, `${BASE_URL}?state=hover`]);
});

test("preserves shared-adapter registration identity while verifying states", async () => {
  const dir = projectDir();
  const base = `${BASE_URL}?registrationId=preview-123`;
  const hover = `${base}&state=hover`;
  seed(dir, { harnessPath: "/__ikran/component/button?registrationId=preview-123" });
  const navigations: string[] = [];
  const result = await verifyComponentLiveHeroes(
    dir,
    {},
    fakeDeps({
      [base]: { report: { ...VALID_REPORT, href: base } },
      [hover]: { report: { ...VALID_REPORT, href: hover } }
    }, navigations)
  );

  expect(result).toMatchObject({ ok: true, all_passed: true });
  expect(navigations).toEqual([base, hover]);
});

test("a dev-server 500 surfaces as http_error without a browser navigation", async () => {
  const dir = projectDir();
  seed(dir);
  const navigations: string[] = [];
  const script: Script = {
    [BASE_URL]: { status: 500 },
    [`${BASE_URL}?state=hover`]: {
      report: { ...VALID_REPORT, href: `${BASE_URL}?state=hover` }
    }
  };
  const result = await verifyComponentLiveHeroes(
    dir,
    {},
    fakeDeps(script, navigations)
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.all_passed).toBe(false);
  const [failed, passed] = result.entries[0]!.results;
  expect(failed).toMatchObject({
    state: "default",
    ok: false,
    reason: "http_error",
    status: 500
  });
  expect(passed).toMatchObject({ state: "hover", ok: true });
  // The 500 URL was preflighted only — never loaded into the iframe.
  expect(navigations).toEqual([`${BASE_URL}?state=hover`]);
});

test("a page that never reports geometry is a geometry_timeout", async () => {
  const dir = projectDir();
  seed(dir);
  const result = await verifyComponentLiveHeroes(
    dir,
    {},
    fakeDeps({}, [])
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.all_passed).toBe(false);
  expect(result.entries[0]!.results.map((r) => r.ok ? null : !r.ok && r.reason)).toEqual([
    "geometry_timeout",
    "geometry_timeout"
  ]);
});

test("a stable zero-size report is identified without masquerading as a timeout", async () => {
  const dir = projectDir();
  seed(dir, { stateMatrix: [] });
  const result = await verifyComponentLiveHeroes(
    dir,
    { entryIds: ["component.button"] },
    fakeDeps(
      {
        [BASE_URL]: {
          report: { href: BASE_URL, x: 0, y: 0, width: 0, height: 0 }
        }
      },
      []
    )
  );
  expect(result).toMatchObject({
    ok: true,
    all_passed: false,
    entries: [{
      results: [{ ok: false, reason: "zero_extent" }]
    }]
  });
});

test("out-of-viewport bounds are reported precisely", async () => {
  const dir = projectDir();
  seed(dir);
  const wide = { href: BASE_URL, x: 0, y: 0, width: 1200, height: 40 };
  const result = await verifyComponentLiveHeroes(
    dir,
    { entryIds: ["component.button"] },
    fakeDeps(
      {
        [BASE_URL]: { report: wide },
        [`${BASE_URL}?state=hover`]: {
          report: { ...VALID_REPORT, href: `${BASE_URL}?state=hover` }
        }
      },
      []
    )
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.all_passed).toBe(false);
  expect(result.entries[0]!.results[0]).toMatchObject({
    ok: false,
    reason: "out_of_viewport"
  });
  expect(result.entries[0]!.results[1]).toMatchObject({ ok: true });
});

test("a stale surface skips verification and never launches a browser", async () => {
  const dir = projectDir();
  seed(dir);
  // The surface turns stale AFTER the declaration (the Agent edited code
  // without record_preview) — verify must refuse to load it.
  const db = new DatabaseSync(getProjectDbPath(dir));
  try {
    db.prepare(
      `UPDATE prototype_surfaces SET stale = 1, stale_reason = 'code_changed'
       WHERE id = 'surface-1'`
    ).run();
  } finally {
    db.close();
  }
  const launch = { called: false };
  const result = await verifyComponentLiveHeroes(
    dir,
    {},
    fakeDeps({}, [], launch)
  );
  expect(launch.called).toBe(false);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.all_passed).toBe(false);
  expect(result.entries[0]).toMatchObject({
    entry_id: "component.button",
    ok: false,
    skipped: "surface_stale",
    results: []
  });
});

test("entryIds scope: unknown ids are entry_not_found, unlisted heroes are untouched", async () => {
  const dir = projectDir();
  seed(dir);
  const result = await verifyComponentLiveHeroes(
    dir,
    { entryIds: ["component.missing"] },
    fakeDeps({}, [])
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.entries).toEqual([
    {
      entry_id: "component.missing",
      harness_url: null,
      ok: false,
      skipped: "entry_not_found",
      results: []
    }
  ]);
});

test("an out-of-range timeoutMs is rejected before any work", async () => {
  const dir = projectDir();
  seed(dir);
  const launch = { called: false };
  const result = await verifyComponentLiveHeroes(
    dir,
    { timeoutMs: 50 },
    fakeDeps({}, [], launch)
  );
  expect(result).toMatchObject({ ok: false, reason: "invalid_input" });
  expect(launch.called).toBe(false);
});

test("browser launch failure is a typed browser_unavailable", async () => {
  const dir = projectDir();
  seed(dir);
  const deps: LiveHeroVerifyDeps = {
    launchBrowser: async () => {
      throw new Error("no chromium");
    },
    fetchStatus: async () => ({ ok: true, status: 200 })
  };
  const result = await verifyComponentLiveHeroes(dir, {}, deps);
  expect(result).toEqual({ ok: false, reason: "browser_unavailable" });
});
