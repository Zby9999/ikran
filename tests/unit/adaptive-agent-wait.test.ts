import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

import {
  ADAPTIVE_WAIT_WINDOW_MS,
  applyPresenceToLease,
  createWaitLease,
  presenceIsEngaged,
  waitLeaseDecision
} from "../../lib/runtime/adaptive-agent-wait";
import {
  reportWorkbenchPresence,
  waitForAgentCommand
} from "../../lib/runtime/adaptive-agent-wait";
import {
  closeProjectDb,
  initializeProjectDb,
  openProjectDb
} from "../../lib/runtime/db";
import { recordEvidencePackage } from "../../lib/runtime/evidence-package";
import { listEvents } from "../../lib/runtime/events";
import { prepareDesignIntentAlignment } from "../../lib/runtime/alignment-preparation";
import { setDesignLanguageDescription } from "../../lib/runtime/project-readiness";
import { registerSeedReference } from "../../lib/runtime/seed-reference";

const readEligibleWait = () =>
  ({
    ok: true,
    eligible: true,
    stage: "alignment-answering",
    seed_reference_count: 1,
    wait_scope: { kind: "alignment_handoff" }
  }) as const;

describe("adaptive Agent wait lease", () => {
  test("returns not_applicable before Seed Reference registration", async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-wait-no-seed-"));
    try {
      initializeProjectDb(projectPath);
      await expect(
        waitForAgentCommand(projectPath, { windowMs: 0 })
      ).resolves.toEqual({
        ok: true,
        reason: "not_applicable",
        command: null,
        stage: "seed-reference-registration",
        not_applicable_reason: "seed_reference_required"
      });
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  test("returns not_applicable outside a designer handoff stage", async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-wait-finished-"));
    try {
      initializeProjectDb(projectPath);
      const seed = registerSeedReference(projectPath, {
        figmaSeedReference:
          "https://www.figma.com/design/WaitDone/Mock?node-id=1:2",
        originalDesignIntent: "Finished wait fixture"
      });
      if (!seed.ok) throw new Error(seed.reason);
      const db = openProjectDb(projectPath);
      try {
        db.prepare(
          `UPDATE project_workflow
           SET stage = 'initial-design-system-preparing', updated_at = ?
           WHERE singleton = 1`
        ).run("2026-08-10T00:00:00.000Z");
      } finally {
        closeProjectDb(db);
      }

      await expect(
        waitForAgentCommand(projectPath, { windowMs: 0 })
      ).resolves.toEqual({
        ok: true,
        reason: "not_applicable",
        command: null,
        stage: "initial-design-system-preparing",
        not_applicable_reason: "outside_designer_handoff"
      });
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  test("fails closed when wait eligibility state cannot be read", async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-wait-state-error-"));
    try {
      initializeProjectDb(projectPath);
      await expect(
        waitForAgentCommand(projectPath, {
          windowMs: 0,
          readWaitEligibility: () => {
            throw new Error("injected workflow read failure");
          }
        })
      ).resolves.toEqual({
        ok: false,
        reason: "state_unavailable",
        command: null
      });
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  test("starts with one three-minute window and rolls to now plus three minutes", () => {
    const lease = createWaitLease(1_000);
    expect(ADAPTIVE_WAIT_WINDOW_MS).toBe(180_000);
    expect(lease.deadlineMs).toBe(181_000);

    const renewed = applyPresenceToLease(
      lease,
      {
        visible: true,
        focused: true,
        recentInteraction: true,
        dirty: false,
        semanticActivity: false,
        closed: false
      },
      120_000
    );
    expect(renewed.deadlineMs).toBe(300_000);
  });

  test("background, heartbeat-only, and idle presence do not renew", () => {
    const lease = createWaitLease(0);
    expect(
      presenceIsEngaged({
        visible: false,
        focused: true,
        recentInteraction: true,
        dirty: false,
        semanticActivity: false,
        closed: false
      })
    ).toBe(false);
    expect(
      applyPresenceToLease(
        lease,
        {
          visible: true,
          focused: true,
          recentInteraction: false,
          dirty: false,
          semanticActivity: false,
          closed: false
        },
        100_000
      )
    ).toEqual(lease);
    expect(waitLeaseDecision(lease, 180_001)).toEqual({
      done: true,
      reason: "idle_no_command"
    });
  });

  test("dirty or submitted semantic activity renews only while visible and focused", () => {
    const lease = createWaitLease(0);
    for (const activity of [
      { dirty: true, semanticActivity: false },
      { dirty: false, semanticActivity: true }
    ]) {
      expect(
        applyPresenceToLease(
          lease,
          {
            visible: true,
            focused: true,
            recentInteraction: false,
            closed: false,
            ...activity
          },
          60_000
        ).deadlineMs
      ).toBe(240_000);
    }
  });

  test("page close ends the operational wait without advancing workflow", () => {
    const lease = createWaitLease(0);
    expect(
      applyPresenceToLease(
        lease,
        {
          visible: false,
          focused: false,
          recentInteraction: false,
          dirty: false,
          semanticActivity: false,
          closed: true
        },
        10_000
      )
    ).toMatchObject({ closed: true, deadlineMs: 180_000 });
    expect(waitLeaseDecision({ ...lease, closed: true }, 10_000)).toEqual({
      done: true,
      reason: "page_closed_no_command"
    });
  });

  test("fake clock renews an active wait and then exits after activity stops", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-wait-clock-"));
    try {
      initializeProjectDb(projectPath);
      const result = waitForAgentCommand(projectPath, {
        windowMs: 180,
        readWaitEligibility: readEligibleWait
      });
      await vi.advanceTimersByTimeAsync(120);
      reportWorkbenchPresence(projectPath, {
        visible: true,
        focused: true,
        recentInteraction: true,
        dirty: false,
        semanticActivity: false,
        closed: false
      });
      await vi.advanceTimersByTimeAsync(179);
      let settled = false;
      void result.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({
        ok: true,
        reason: "idle_no_command",
        command: null
      });
    } finally {
      vi.useRealTimers();
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  test("durable command wins the timeout race and survives a later wait", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-wait-command-"));
    try {
      initializeProjectDb(projectPath);
      const seed = registerSeedReference(projectPath, {
        figmaSeedReference:
          "https://www.figma.com/design/WaitCmd/Mock?node-id=1:2",
        originalDesignIntent: "Wait command"
      });
      if (!seed.ok) throw new Error(seed.reason);
      const evidence = recordEvidencePackage(projectPath, {
        seedReferenceId: seed.record.id,
        frame: { nodeId: "1:2", name: "Mock" },
        evidenceViews: { rawData: "available", screenshot: "missing" }
      });
      if (!evidence.ok) throw new Error(evidence.reason);
      setDesignLanguageDescription(projectPath, "Wait contract");

      const waiting = waitForAgentCommand(projectPath, { windowMs: 180 });
      await vi.advanceTimersByTimeAsync(179);
      const prepared = prepareDesignIntentAlignment(projectPath);
      expect(prepared.ok).toBe(true);
      await expect(waiting).resolves.toMatchObject({
        reason: "command_available",
        command: { command_type: "prepare_design_intent_alignment" }
      });
      await expect(
        waitForAgentCommand(projectPath, { windowMs: 180 })
      ).resolves.toMatchObject({
        reason: "command_available",
        command: { id: prepared.ok ? prepared.command.id : "" }
      });
    } finally {
      vi.useRealTimers();
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  test("presence is ephemeral and cancellation leaves workflow unchanged", async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-wait-cancel-"));
    try {
      initializeProjectDb(projectPath);
      const beforeEvents = listEvents(projectPath).length;
      reportWorkbenchPresence(projectPath, {
        visible: true,
        focused: true,
        recentInteraction: false,
        dirty: true,
        semanticActivity: false,
        closed: false
      });
      expect(listEvents(projectPath)).toHaveLength(beforeEvents);
      const controller = new AbortController();
      const waiting = waitForAgentCommand(projectPath, {
        signal: controller.signal,
        readWaitEligibility: readEligibleWait
      });
      controller.abort();
      await expect(waiting).resolves.toEqual({
        ok: true,
        reason: "cancelled",
        command: null
      });
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  test("a transient pending-command read error recovers on the next signal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-wait-read-error-"));
    let reads = 0;
    try {
      initializeProjectDb(projectPath);
      const waiting = waitForAgentCommand(projectPath, {
        windowMs: 180,
        readWaitEligibility: readEligibleWait,
        readPendingCommand: () => {
          reads += 1;
          if (reads === 1) throw new Error("transient database lock");
          return {
            id: "recovered-command",
            command_type: "prepare_design_intent_alignment",
            scope: { kind: "alignment_attempt", id: "attempt-1" },
            alignment_attempt_id: "attempt-1",
            payload: {},
            created_at: "2026-07-22T00:00:00.000Z"
          };
        }
      });
      reportWorkbenchPresence(projectPath, {
        visible: true,
        focused: true,
        recentInteraction: true,
        dirty: false,
        semanticActivity: false,
        closed: false
      });
      await expect(waiting).resolves.toEqual({
        ok: true,
        reason: "command_available",
        command: expect.objectContaining({ id: "recovered-command" })
      });
      expect(reads).toBe(2);
    } finally {
      vi.useRealTimers();
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  test("a persistent pending-command read failure is never reported as idle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-wait-read-failed-"));
    try {
      initializeProjectDb(projectPath);
      const waiting = waitForAgentCommand(projectPath, {
        windowMs: 180,
        readWaitEligibility: readEligibleWait,
        readPendingCommand: () => {
          throw new Error("persistent database lock");
        }
      });
      await vi.advanceTimersByTimeAsync(180);
      await expect(waiting).resolves.toEqual({
        ok: false,
        reason: "command_read_failed",
        command: null
      });
    } finally {
      vi.useRealTimers();
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});
