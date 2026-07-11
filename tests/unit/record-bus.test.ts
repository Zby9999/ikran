// Task 11 — in-process record bus: commit-only emit, stable contract, no leaks.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  emitRecordEvent,
  getRecordBusListenerCount,
  resetRecordBusForTests,
  subscribeRecordEvents,
  type RecordBusEvent
} from "../../lib/runtime/record-bus";
import { initializeProjectDb, openProjectDb, closeProjectDb } from "../../lib/runtime/db";
import { registerSeedReference } from "../../lib/runtime/seed-reference";
import { recordEvidencePackage } from "../../lib/runtime/evidence-package";
import {
  createRegionAnnotation,
  deleteRegionAnnotation
} from "../../lib/runtime/region-annotation";

const VALID = "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";
const INTENT = "record-bus fixture";

function withTempProject(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-record-bus-"));
  try {
    initializeProjectDb(dir);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

afterEach(() => {
  resetRecordBusForTests();
});

describe("record bus contract", () => {
  test("subscribe receives emitted events; unsubscribe stops delivery", () => {
    const seen: RecordBusEvent[] = [];
    const unsub = subscribeRecordEvents((e) => seen.push(e));
    expect(getRecordBusListenerCount()).toBe(1);

    emitRecordEvent({
      kind: "seed",
      action: "created",
      id: "s1",
      projectPath: "/tmp/p",
      timestamp: "2026-01-01T00:00:00.000Z"
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      kind: "seed",
      action: "created",
      id: "s1",
      projectPath: "/tmp/p"
    });

    unsub();
    expect(getRecordBusListenerCount()).toBe(0);
    emitRecordEvent({
      kind: "seed",
      action: "created",
      id: "s2",
      projectPath: "/tmp/p",
      timestamp: "2026-01-01T00:00:01.000Z"
    });
    expect(seen).toHaveLength(1);
  });

  test("multiple subscribers; each unsubscribe restores listener count", () => {
    const a = subscribeRecordEvents(() => {});
    const b = subscribeRecordEvents(() => {});
    expect(getRecordBusListenerCount()).toBe(2);
    a();
    expect(getRecordBusListenerCount()).toBe(1);
    b();
    expect(getRecordBusListenerCount()).toBe(0);
  });

  test("listener throw after successful publish does not fail caller", () => {
    const healthy: RecordBusEvent[] = [];
    subscribeRecordEvents(() => {
      throw new Error("listener boom");
    });
    subscribeRecordEvents((e) => healthy.push(e));

    expect(() => {
      emitRecordEvent({
        kind: "evidence",
        action: "created",
        id: "e1",
        projectPath: "/tmp/p",
        timestamp: "2026-01-01T00:00:00.000Z"
      });
    }).not.toThrow();

    expect(healthy).toHaveLength(1);
    expect(healthy[0]?.id).toBe("e1");
  });
});

describe("domain writes emit only after successful commit", () => {
  test("new seed emits; reused seed does not", () => {
    withTempProject((dir) => {
      const seen: RecordBusEvent[] = [];
      const unsub = subscribeRecordEvents((e) => seen.push(e));

      const first = registerSeedReference(dir, {
        figmaSeedReference: VALID,
        originalDesignIntent: INTENT
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        kind: "seed",
        action: "created",
        id: first.record.id,
        projectPath: path.resolve(dir)
      });

      const reused = registerSeedReference(dir, {
        figmaSeedReference:
          "https://www.figma.com/design/AbCdEf/Checkout?node-id=1-2&t=zzz",
        originalDesignIntent: "ignored"
      });
      expect(reused.ok).toBe(true);
      if (!reused.ok) return;
      expect(reused.reused).toBe(true);
      expect(seen).toHaveLength(1);

      unsub();
    });
  });

  test("evidence create emits; annotation create/delete emit", () => {
    withTempProject((dir) => {
      const seen: RecordBusEvent[] = [];
      const unsub = subscribeRecordEvents((e) => seen.push(e));

      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID,
        originalDesignIntent: INTENT
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      const evidence = recordEvidencePackage(dir, {
        figmaSeedReference: VALID,
        frame: { nodeId: "1:2", name: "Checkout" },
        evidenceViews: { rawData: "available", screenshot: "missing" }
      });
      expect(evidence.ok).toBe(true);
      if (!evidence.ok) return;
      expect(seen.some((e) => e.kind === "evidence" && e.action === "created")).toBe(
        true
      );
      expect(
        seen.find((e) => e.kind === "evidence")?.id
      ).toBe(evidence.record.id);

      const ann = createRegionAnnotation(dir, {
        surfaceArtifactId: evidence.record.id,
        author: "designer",
        body: "Placeholder annotation",
        rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 }
      });
      expect(ann.ok).toBe(true);
      if (!ann.ok) return;
      expect(
        seen.some(
          (e) =>
            e.kind === "annotation" &&
            e.action === "created" &&
            e.id === ann.record.id
        )
      ).toBe(true);

      const del = deleteRegionAnnotation(dir, ann.record.id);
      expect(del.ok).toBe(true);
      expect(
        seen.some(
          (e) =>
            e.kind === "annotation" &&
            e.action === "deleted" &&
            e.id === ann.record.id
        )
      ).toBe(true);

      unsub();
    });
  });

  test("listener throw after evidence publish does not return db_error", () => {
    withTempProject((dir) => {
      subscribeRecordEvents(() => {
        throw new Error("listener boom");
      });

      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID,
        originalDesignIntent: INTENT
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      const evidence = recordEvidencePackage(dir, {
        figmaSeedReference: VALID,
        frame: { nodeId: "1:2", name: "Checkout" },
        evidenceViews: { rawData: "available", screenshot: "missing" }
      });
      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        expect(evidence.reason).not.toBe("db_error");
        return;
      }
    });
  });

  test("rollback / db_error does not emit", () => {
    withTempProject((dir) => {
      const db = openProjectDb(dir);
      try {
        db.exec(`
          CREATE TRIGGER fail_event_insert
          BEFORE INSERT ON events
          BEGIN
            SELECT RAISE(ABORT, 'forced_event_insert_failure');
          END;
        `);
      } finally {
        closeProjectDb(db);
      }

      const seen: RecordBusEvent[] = [];
      const unsub = subscribeRecordEvents((e) => seen.push(e));

      const res = registerSeedReference(dir, {
        figmaSeedReference: VALID,
        originalDesignIntent: INTENT
      });
      expect(res.ok).toBe(false);
      expect(seen).toHaveLength(0);

      unsub();
    });
  });
});
