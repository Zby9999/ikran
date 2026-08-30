import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { initializeProjectDb } from "../../lib/runtime/db";
import {
  beginComponentFormalizationTiming,
  beginComponentFormalizationTimingStage,
  completeComponentFormalizationTiming,
  ensureComponentFormalizationTiming,
  finishComponentFormalizationTimingStage,
  getComponentFormalizationTiming,
  interruptComponentFormalizationTiming
} from "../../lib/runtime/component-formalization-timing";
import { scaffoldComponentHarnessCommand } from "../../lib/runtime/commands";

const projects: string[] = [];

function project(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-formalization-timing-"));
  projects.push(dir);
  initializeProjectDb(dir);
  return dir;
}

function clock(initial = "2026-08-27T00:00:00.000Z") {
  let now = Date.parse(initial);
  return {
    now: () => new Date(now),
    advance(ms: number) {
      now += ms;
    }
  };
}

afterEach(() => {
  for (const dir of projects.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("records a sanitized successful timing breakdown with wait and milestone totals", () => {
  const dir = project();
  const time = clock();
  const session = beginComponentFormalizationTiming(
    dir,
    {
      runId: "run-1",
      componentEntryIds: ["component.button"],
      stateCount: 3
    },
    { now: time.now }
  );

  time.advance(200);
  const reconcile = beginComponentFormalizationTimingStage(
    dir,
    session.id,
    "conversation_reconciliation",
    { componentCount: 1 },
    { now: time.now }
  );
  time.advance(100);
  finishComponentFormalizationTimingStage(
    dir,
    reconcile.id,
    { status: "succeeded" },
    { now: time.now }
  );

  time.advance(50);
  const preview = beginComponentFormalizationTimingStage(
    dir,
    session.id,
    "preview_readiness",
    { previewStartup: "cold", cacheStatus: "miss" },
    { now: time.now }
  );
  time.advance(250);
  finishComponentFormalizationTimingStage(
    dir,
    preview.id,
    { status: "succeeded" },
    { now: time.now }
  );

  const visual = beginComponentFormalizationTimingStage(
    dir,
    session.id,
    "live_hero_declaration",
    {},
    { now: time.now }
  );
  time.advance(25);
  finishComponentFormalizationTimingStage(
    dir,
    visual.id,
    { status: "succeeded" },
    { now: time.now }
  );

  const verify = beginComponentFormalizationTimingStage(
    dir,
    session.id,
    "verification",
    { componentCount: 1, stateCount: 3, cacheStatus: "miss" },
    { now: time.now }
  );
  time.advance(400);
  finishComponentFormalizationTimingStage(
    dir,
    verify.id,
    { status: "succeeded" },
    { now: time.now }
  );

  const formalize = beginComponentFormalizationTimingStage(
    dir,
    session.id,
    "formalization",
    {},
    { now: time.now }
  );
  time.advance(75);
  finishComponentFormalizationTimingStage(
    dir,
    formalize.id,
    { status: "succeeded" },
    { now: time.now }
  );
  completeComponentFormalizationTiming(dir, session.id, { now: time.now });

  const result = getComponentFormalizationTiming(dir, session.id);
  expect(result).toMatchObject({
    id: session.id,
    run_id: "run-1",
    component_entry_ids: ["component.button"],
    component_count: 1,
    state_count: 3,
    status: "completed",
    total_wall_ms: 1100,
    runtime_ms: 850,
    agent_wait_ms: 250,
    retry_count: 0,
    preview_startups: ["cold"],
    cache_statuses: ["miss"],
    time_to_visual_ms: 625,
    time_to_verified_ms: 1025,
    time_to_formalized_ms: 1100
  });
  expect(result?.stages).toMatchObject({
    conversation_reconciliation: { attempts: 1, runtime_ms: 100, agent_wait_ms: 200 },
    preview_readiness: { attempts: 1, runtime_ms: 250, agent_wait_ms: 50 },
    live_hero_declaration: { attempts: 1, runtime_ms: 25 },
    verification: { attempts: 1, runtime_ms: 400 },
    formalization: { attempts: 1, runtime_ms: 75 }
  });
  expect(JSON.stringify(result)).not.toContain("token");
  expect(JSON.stringify(result)).not.toContain("sourceCode");
});

test("merges later component declarations into the active run timing scope", () => {
  const dir = project();
  const first = ensureComponentFormalizationTiming(dir, {
    runId: "run-batch",
    componentEntryIds: ["component.alpha"],
    stateCount: 1
  });
  const second = ensureComponentFormalizationTiming(dir, {
    runId: "run-batch",
    componentEntryIds: ["component.beta"],
    stateCount: 3
  });
  ensureComponentFormalizationTiming(dir, {
    runId: "run-batch",
    componentEntryIds: ["component.beta"],
    stateCount: 3
  });

  expect(second.id).toBe(first.id);
  expect(getComponentFormalizationTiming(dir, first.id)).toMatchObject({
    component_entry_ids: ["component.alpha", "component.beta"],
    component_count: 2,
    state_count: 4
  });
});

test("closes a failed stage with a typed failure stage", () => {
  const dir = project();
  const time = clock();
  const session = beginComponentFormalizationTiming(
    dir,
    { runId: "run-failed", componentEntryIds: ["component.card"], stateCount: 1 },
    { now: time.now }
  );
  const stage = beginComponentFormalizationTimingStage(
    dir,
    session.id,
    "verification",
    {},
    { now: time.now }
  );
  time.advance(20);
  finishComponentFormalizationTimingStage(
    dir,
    stage.id,
    { status: "failed", failureCode: "state_render_failed" },
    { now: time.now }
  );

  expect(getComponentFormalizationTiming(dir, session.id)).toMatchObject({
    status: "failed",
    failure_stage: "verification",
    failure_code: "state_render_failed",
    total_wall_ms: 20
  });
});

test("reports the latest retryable failure as the current blocker while the session remains open", () => {
  const dir = project();
  const time = clock();
  const session = beginComponentFormalizationTiming(
    dir,
    { runId: "run-blocked", componentEntryIds: ["component.header"], stateCount: 1 },
    { now: time.now }
  );
  const stage = beginComponentFormalizationTimingStage(
    dir,
    session.id,
    "verification",
    {},
    { now: time.now }
  );
  time.advance(12);
  finishComponentFormalizationTimingStage(
    dir,
    stage.id,
    { status: "failed", failureCode: "zero_extent", retryable: true },
    { now: time.now }
  );

  expect(getComponentFormalizationTiming(dir, session.id)).toMatchObject({
    status: "running",
    current_blocker: {
      stage: "verification",
      failure_code: "zero_extent",
      attempt: 1
    }
  });
});

test("counts retries without overwriting earlier attempts", () => {
  const dir = project();
  const time = clock();
  const session = beginComponentFormalizationTiming(
    dir,
    { runId: "run-retry", componentEntryIds: ["component.input"], stateCount: 2 },
    { now: time.now }
  );
  const first = beginComponentFormalizationTimingStage(
    dir,
    session.id,
    "preview_readiness",
    { previewStartup: "cold" },
    { now: time.now }
  );
  time.advance(10);
  finishComponentFormalizationTimingStage(
    dir,
    first.id,
    { status: "failed", failureCode: "preview_not_ready", retryable: true },
    { now: time.now }
  );
  time.advance(5);
  const second = beginComponentFormalizationTimingStage(
    dir,
    session.id,
    "preview_readiness",
    { previewStartup: "warm" },
    { now: time.now }
  );
  time.advance(8);
  finishComponentFormalizationTimingStage(
    dir,
    second.id,
    { status: "succeeded" },
    { now: time.now }
  );
  completeComponentFormalizationTiming(dir, session.id, { now: time.now });

  expect(getComponentFormalizationTiming(dir, session.id)).toMatchObject({
    status: "completed",
    current_blocker: null,
    retry_count: 1,
    preview_startups: ["cold", "warm"],
    stages: {
      preview_readiness: { attempts: 2, runtime_ms: 18, agent_wait_ms: 5 }
    }
  });
});

test("does not count normal repeated stages for different components as retries", () => {
  const dir = project();
  const time = clock();
  const session = beginComponentFormalizationTiming(
    dir,
    {
      runId: "run-multiple-components",
      componentEntryIds: ["component.alpha", "component.beta"],
      stateCount: 2
    },
    { now: time.now }
  );
  for (let index = 0; index < 2; index += 1) {
    const span = beginComponentFormalizationTimingStage(
      dir,
      session.id,
      "artifact_declaration",
      { componentCount: 1, stateCount: 1 },
      { now: time.now }
    );
    time.advance(5);
    finishComponentFormalizationTimingStage(
      dir,
      span.id,
      { status: "succeeded" },
      { now: time.now }
    );
  }
  completeComponentFormalizationTiming(dir, session.id, { now: time.now });

  expect(getComponentFormalizationTiming(dir, session.id)).toMatchObject({
    retry_count: 0,
    stages: { artifact_declaration: { attempts: 2, succeeded: 2 } }
  });
});

test("marks an open stage and session interrupted", () => {
  const dir = project();
  const time = clock();
  const session = beginComponentFormalizationTiming(
    dir,
    { runId: "run-interrupted", componentEntryIds: [], stateCount: 0 },
    { now: time.now }
  );
  beginComponentFormalizationTimingStage(
    dir,
    session.id,
    "artifact_declaration",
    {},
    { now: time.now }
  );
  time.advance(30);
  interruptComponentFormalizationTiming(
    dir,
    session.id,
    "agent_disconnected",
    { now: time.now }
  );

  expect(getComponentFormalizationTiming(dir, session.id)).toMatchObject({
    status: "interrupted",
    failure_stage: "artifact_declaration",
    failure_code: "agent_disconnected",
    runtime_ms: 30,
    total_wall_ms: 30,
    stages: { artifact_declaration: { interrupted: 1 } }
  });
});

test("existing command wrappers record stages without changing their result", () => {
  const dir = project();
  const session = beginComponentFormalizationTiming(dir, {
    runId: "run-command",
    componentEntryIds: [],
    stateCount: 0
  });
  const result = scaffoldComponentHarnessCommand(dir, {
    helperPath: "prototype/lib/ikran-component-harness.js"
  });

  expect(result).toMatchObject({ ok: true, already_present: false });
  expect(getComponentFormalizationTiming(dir, session.id)).toMatchObject({
    status: "running",
    stages: { harness_preparation: { attempts: 1, succeeded: 1 } }
  });
});
