import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";

import { planComponentHero } from "../components/workbench/design-system-view-model";
import { recordArtifactWrittenCommand } from "../lib/runtime/commands";
import { initializeProjectDb } from "../lib/runtime/db";
import { getDesignSystemView } from "../lib/runtime/design-system-view";
import { getProjectDbPath } from "../lib/runtime/paths";
import {
  resetAutomaticComponentPreviewOrchestrationHostForTests,
  setAutomaticComponentPreviewOrchestrationHostForTests
} from "../lib/runtime/component-preview-orchestration";
import { resolveComponentPreviewException } from "../lib/runtime/component-preview-exception";
import {
  defaultLiveHeroVerifyDeps,
  type LiveHeroVerifyDeps
} from "../lib/runtime/live-hero-verify";

type ScheduledWork = () => Promise<void>;
type Measurement = { startedAt: number; firstGeometryAt: number | null };

const repositoryRoot = process.cwd();
const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-component-preview-real-"));
const prototypePath = path.join(projectPath, "prototype");
const scheduled: ScheduledWork[] = [];
let server: ChildProcess | null = null;
let activeMeasurement: Measurement | null = null;

function write(relativePath: string, body: string): void {
  const absolutePath = path.join(projectPath, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, body, "utf8");
}

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

async function availablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      if (!address || typeof address === "string") {
        listener.close();
        reject(new Error("Could not allocate a local preview port."));
        return;
      }
      listener.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      await response.arrayBuffer();
      if (response.status < 500) return;
    } catch {
      // Next is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Preview server did not become ready: ${url}`);
}

function seedProject(port: number): void {
  initializeProjectDb(projectPath);
  write(
    "prototype/package.json",
    `${JSON.stringify({ private: true, dependencies: { next: "16.3.0", react: "19.2.7", "react-dom": "19.2.7" } }, null, 2)}\n`
  );
  write(
    "prototype/app/layout.tsx",
    "export default function Layout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n"
  );
  write("prototype/app/page.tsx", "export default function Page() { return <main>Preview host</main>; }\n");
  write(
    "prototype/components/TextLink.tsx",
    "export function TextLink({ label = 'Read details' }: { label?: string }) { return <a href='#details' style={{ color: '#0b57d0', font: '600 15px system-ui' }}>{label}</a>; }\n"
  );
  write(
    "prototype/components/StickyNavigation.tsx",
    `export function StickyNavigation({ mode = "default" }: { mode?: string }) {
  if (mode === "broken") throw new Error("Intentional non-default state failure");
  return <nav style={{ position: "sticky", top: 0, display: "flex", gap: 12, padding: 12, background: "white", borderBottom: "1px solid #ddd" }}>
    <strong>Study</strong><span>{mode === "expanded" ? "Overview · Notes · Sources" : "Overview"}</span>
  </nav>;
}\n`
  );
  write(
    "prototype/components/ProviderCard.tsx",
    "export function ProviderCard({ title = 'Provider fixture' }: { title?: string }) { return <article>{title}</article>; }\n"
  );
  write(
    "prototype/providers/ThemeProvider.tsx",
    "export function ThemeProvider({ children }: { children?: React.ReactNode }) { return <section data-theme='study'>{children}</section>; }\n"
  );

  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    const now = new Date().toISOString();
    const insertEntry = db.prepare(
      `INSERT INTO design_system_entries
       (id, source_artifact_path, file_kind, section, entry_id, name,
        value_json, meaning, status, links_json, source_captures_json,
        position, created_at, updated_at)
       VALUES (?, ?, 'component-spec', 'components.spec', ?, ?, ?, ?,
               'candidate', '["card-real"]', '[]', ?, ?, ?)`
    );
    const entries = [
      {
        rowId: "row-text-link",
        entryId: "component.text-link",
        name: "Text Link",
        modulePath: "prototype/components/TextLink.tsx",
        states: []
      },
      {
        rowId: "row-sticky-navigation",
        entryId: "component.sticky-navigation",
        name: "Sticky Navigation",
        modulePath: "prototype/components/StickyNavigation.tsx",
        states: [{ state: "expanded" }, { state: "broken" }]
      },
      {
        rowId: "row-provider-card",
        entryId: "component.provider-card",
        name: "Provider Card",
        modulePath: "prototype/components/ProviderCard.tsx",
        states: []
      }
    ];
    for (const [position, entry] of entries.entries()) {
      const value = {
        description: entry.name,
        props: [], variants: [], stateMatrix: entry.states,
        guidelines: [], tokenLinks: [], codeLinks: []
      };
      const sourcePath = `design-system/components/${entry.entryId.slice("component.".length)}.json`;
      write(sourcePath, `${JSON.stringify({ id: entry.entryId, name: entry.name, meaning: entry.name, status: "candidate", links: ["card-real"], value }, null, 2)}\n`);
      insertEntry.run(
        entry.rowId,
        sourcePath,
        entry.entryId,
        entry.name,
        JSON.stringify(value),
        entry.name,
        position,
        now,
        now
      );
    }
    db.prepare(
      `INSERT INTO prototype_runs
       (id, run_id, source_artifact_path, prototype_root, dev_command,
        seed_reference_ids_json, evidence_version_ids_json,
        design_system_version, created_at, updated_at, kind, intent,
        used_candidate_ids_json)
       VALUES ('prototype-run', 'run-real', 'prototype/app/page.tsx',
               'prototype', 'npm run dev', '[]', '[]', 'ds-real', ?, ?,
               'seed_reconstruction', NULL, '[]')`
    ).run(now, now);
    db.prepare(
      `INSERT INTO prototype_surfaces
       (id, prototype_run_id, surface_key, name, preview_url, preview_port,
        readiness, readiness_reason, stale, stale_reason, created_at, updated_at)
       VALUES ('surface-real', 'prototype-run', 'default', 'Real Preview', ?, ?,
               'ready', NULL, 0, NULL, ?, ?)`
    ).run(`http://127.0.0.1:${port}`, port, now, now);
  } finally {
    db.close();
  }
}

const realDeps: LiveHeroVerifyDeps = {
  async launchBrowser() {
    const browser = await defaultLiveHeroVerifyDeps.launchBrowser();
    return {
      async newPage() {
        const page = await browser.newPage();
        return {
          setContent: (html) => page.setContent(html),
          async loadHarnessAndAwaitReport(url, timeoutMs) {
            const result = await page.loadHarnessAndAwaitReport(url, timeoutMs);
            if (result !== null && activeMeasurement?.firstGeometryAt === null) {
              activeMeasurement.firstGeometryAt = performance.now();
            }
            return result;
          }
        };
      },
      close: () => browser.close()
    };
  },
  fetchStatus: (url) => defaultLiveHeroVerifyDeps.fetchStatus(url)
};

function textDeclaration(iteration: number) {
  return recordArtifactWrittenCommand(projectPath, {
    path: "prototype/components/TextLink.tsx",
    artifactType: "code",
    semanticPurpose: "Real Text Link implementation",
    relatedRecordIds: [],
    readiness: "ready",
    componentPreview: {
      runId: "run-real",
      surfaceId: "surface-real",
      entryId: "component.text-link",
      modulePath: "prototype/components/TextLink.tsx",
      exportName: "TextLink",
      semanticImpact: "none",
      defaultArgs: { label: `Read details ${iteration}` },
      stateArgs: {}
    }
  });
}

async function finishScheduledMeasurement(): Promise<{ ttvMs: number; verifiedMs: number }> {
  const work = scheduled.shift();
  if (!work || !activeMeasurement) throw new Error("Automatic verification was not scheduled.");
  await work();
  const endedAt = performance.now();
  const result = {
    ttvMs: (activeMeasurement.firstGeometryAt ?? endedAt) - activeMeasurement.startedAt,
    verifiedMs: endedAt - activeMeasurement.startedAt
  };
  activeMeasurement = null;
  return result;
}

async function main(): Promise<void> {
  const port = await availablePort();
  seedProject(port);
  symlinkSync(path.join(repositoryRoot, "node_modules"), path.join(prototypePath, "node_modules"), "dir");
  setAutomaticComponentPreviewOrchestrationHostForTests({
    deps: realDeps,
    schedule: (work) => scheduled.push(work)
  });

  activeMeasurement = { startedAt: performance.now(), firstGeometryAt: null };
  const firstDeclaration = textDeclaration(0);
  if (!firstDeclaration.ok || !("component_preview" in firstDeclaration)) {
    throw new Error(`Initial Text Link declaration failed: ${JSON.stringify(firstDeclaration)}`);
  }
  server = spawn(
    process.execPath,
    [path.join(repositoryRoot, "node_modules/next/dist/bin/next"), "dev", "--webpack", "-H", "127.0.0.1", "-p", String(port)],
    { cwd: prototypePath, stdio: ["ignore", "pipe", "pipe"] }
  );
  const serverErrors: string[] = [];
  server.stderr?.on("data", (chunk) => serverErrors.push(String(chunk)));
  try {
    await waitForServer(`http://127.0.0.1:${port}`);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${serverErrors.join("")}`
    );
  }
  const cold = await finishScheduledMeasurement();

  const warm: Array<{ ttvMs: number; verifiedMs: number }> = [];
  for (let iteration = 1; iteration <= 10; iteration += 1) {
    activeMeasurement = { startedAt: performance.now(), firstGeometryAt: null };
    const declaration = textDeclaration(iteration);
    if (!declaration.ok || !("component_preview" in declaration)) {
      throw new Error(`Warm declaration ${iteration} failed: ${JSON.stringify(declaration)}`);
    }
    warm.push(await finishScheduledMeasurement());
  }

  activeMeasurement = { startedAt: performance.now(), firstGeometryAt: null };
  const stickyDeclaration = recordArtifactWrittenCommand(projectPath, {
    path: "prototype/components/StickyNavigation.tsx",
    artifactType: "code",
    semanticPurpose: "Real Sticky Navigation implementation",
    relatedRecordIds: [],
    componentPreview: {
      runId: "run-real",
      surfaceId: "surface-real",
      entryId: "component.sticky-navigation",
      modulePath: "prototype/components/StickyNavigation.tsx",
      exportName: "StickyNavigation",
      semanticImpact: "none",
      defaultArgs: { mode: "default" },
      stateArgs: {
        expanded: { mode: "expanded" },
        broken: { mode: "broken" }
      }
    }
  });
  if (!stickyDeclaration.ok || !("component_preview" in stickyDeclaration)) {
    throw new Error(`Sticky declaration failed: ${JSON.stringify(stickyDeclaration)}`);
  }
  const stickyTiming = await finishScheduledMeasurement();

  const providerDeclaration = recordArtifactWrittenCommand(projectPath, {
    path: "prototype/components/ProviderCard.tsx",
    artifactType: "code",
    semanticPurpose: "Real provider-backed component fixture",
    relatedRecordIds: [],
    componentPreview: {
      runId: "run-real",
      surfaceId: "surface-real",
      entryId: "component.provider-card",
      modulePath: "prototype/components/ProviderCard.tsx",
      exportName: "ProviderCard",
      semanticImpact: "possible",
      defaultArgs: { title: "Provider fixture" },
      providerRecipe: {
        modulePath: "prototype/providers/ThemeProvider.tsx",
        exportName: "ThemeProvider",
        props: { theme: "study" }
      }
    }
  });
  if (
    !providerDeclaration.ok ||
    !("component_preview" in providerDeclaration) ||
    !providerDeclaration.component_preview ||
    providerDeclaration.component_preview.automatic
  ) {
    throw new Error(`Provider exception was not emitted: ${JSON.stringify(providerDeclaration)}`);
  }
  const exception = providerDeclaration.component_preview.exception;
  const disposition = resolveComponentPreviewException(projectPath, {
    exceptionId: exception.exception_id,
    expectedDigest: exception.exception_digest,
    disposition: "retain_open_gap",
    rationale: "Provider ownership is intentionally retained as an explicit fixture gap in this real gate.",
    evidenceRecordIds: ["card-real"],
    targetCategory: "open_gap"
  });
  if (!disposition.ok) throw new Error(`Exception resolution failed: ${JSON.stringify(disposition)}`);

  const db = new DatabaseSync(getProjectDbPath(projectPath), { readOnly: true });
  let stickyResults: unknown;
  let events: unknown;
  let statuses: unknown;
  try {
    stickyResults = db.prepare(
      `SELECT state, status, failure_reason FROM component_preview_verification_results
       WHERE registration_id = (SELECT id FROM component_preview_registrations WHERE entry_id = 'component.sticky-navigation')
       ORDER BY CASE state WHEN 'default' THEN 0 WHEN 'expanded' THEN 1 ELSE 2 END`
    ).all();
    events = db.prepare(
      `SELECT type, COUNT(*) AS count FROM events
       WHERE type IN ('component_preview_registered', 'component_preview_verified_candidate', 'component_preview_exception_resolved')
       GROUP BY type ORDER BY type`
    ).all();
    statuses = db.prepare(
      `SELECT entry_id, status FROM design_system_entries
       WHERE entry_id IN ('component.text-link', 'component.sticky-navigation', 'component.provider-card')
       ORDER BY entry_id`
    ).all();
  } finally {
    db.close();
  }
  const view = getDesignSystemView(projectPath);
  if (!view.ok) throw new Error(`Design System view failed: ${view.reason}`);
  const stickyHero = view.view.components.specs.find(
    (entry) => entry.entry_id === "component.sticky-navigation"
  )?.liveHero ?? null;
  const textRegistration = firstDeclaration.component_preview?.automatic
    ? firstDeclaration.component_preview.registration
    : null;
  const warmTtv = warm.map((sample) => sample.ttvMs);
  const warmVerified = warm.map((sample) => sample.verifiedMs);
  const report = {
    schema_version: 43,
    storybook_present: false,
    project_path: projectPath,
    preview_url: `http://127.0.0.1:${port}`,
    text_link_route: textRegistration
      ? `http://127.0.0.1:${port}${textRegistration.adapter_route}`
      : null,
    cold: {
      time_to_visual_ms: Math.round(cold.ttvMs),
      time_to_verified_candidate_ms: Math.round(cold.verifiedMs)
    },
    warm: {
      samples: warm.length,
      time_to_visual_p95_ms: Math.round(percentile95(warmTtv)),
      time_to_verified_candidate_p95_ms: Math.round(percentile95(warmVerified)),
      target_time_to_visual_ms: 3000,
      target_time_to_verified_candidate_ms: 60000
    },
    sticky_navigation: {
      timing_ms: { visual: Math.round(stickyTiming.ttvMs), completed: Math.round(stickyTiming.verifiedMs) },
      verification_results: stickyResults,
      hero_after_state_failure: stickyHero,
      render_plan: planComponentHero(stickyHero, [], null)
    },
    provider_exception: {
      packet: exception,
      disposition
    },
    semantic_events: events,
    design_system_statuses: statuses,
    server_stderr_tail: serverErrors.join("").split("\n").filter(Boolean).slice(-8)
  };
  process.stdout.write(`IKRAN_REAL_COMPONENT_PREVIEW_REPORT=${JSON.stringify(report)}\n`);
  process.stdout.write("IKRAN_REAL_COMPONENT_PREVIEW_HOLDING=1\n");
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

async function run(): Promise<void> {
  try {
    await main();
  } finally {
    resetAutomaticComponentPreviewOrchestrationHostForTests();
    const runningServer = server as ChildProcess | null;
    if (runningServer && !runningServer.killed) runningServer.kill("SIGTERM");
    rmSync(projectPath, { recursive: true, force: true });
  }
}

void run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
