// Unit tests for register_seed_reference atomic record+event semantics.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, expect } from "vitest";
import {
  registerSeedReference,
  parseFigmaSeedIdentity,
  figmaSeedIdentitiesEqual,
  resolveHttpRegisteredVia
} from "../../lib/runtime/seed-reference";
import { listEvents } from "../../lib/runtime/events";
import {
  openProjectDb,
  closeProjectDb,
  initializeProjectDb,
  withProjectTransaction
} from "../../lib/runtime/db";
import { getProjectDbPath } from "../../lib/runtime/paths";
import { logEventOnDb } from "../../lib/runtime/events";

const VALID = "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";
const INTENT = "checkout trust signals";

test.describe("register_seed_reference — atomic record+event (unit)", () => {
  test("happy path: record + audit event both written; event_id is a string", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-seed-unit-"));
    try {
      const res = registerSeedReference(dir, {
        figmaSeedReference: VALID,
        originalDesignIntent: INTENT
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(typeof res.event_id).toBe("string");
      expect(res.event_id).toBeTruthy();
      expect(res.record.figma_seed_reference).toBe(VALID);
      expect(res.record.original_design_intent).toBe(INTENT);
      expect(res.record.file_key).toBe("AbCdEf");
      expect(res.record.node_id).toBe("1:2");

      const ev = listEvents(dir, "seed_reference_registered");
      expect(ev.length).toBe(1);
      expect(ev[0].event_id).toBe(res.event_id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("idempotent: same fileKey+nodeId with different t= reuses existing seed", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-seed-unit-dedupe-"));
    try {
      const firstUrl =
        "https://www.figma.com/design/AbCdEf/Checkout?node-id=0-81&t=aaa-11";
      const secondUrl =
        "https://www.figma.com/design/AbCdEf/Checkout?node-id=0:81&t=bbb-11";

      const first = registerSeedReference(dir, {
        figmaSeedReference: firstUrl,
        originalDesignIntent: INTENT
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.reused).toBeUndefined();
      expect(first.record.file_key).toBe("AbCdEf");
      expect(first.record.node_id).toBe("0:81");

      const second = registerSeedReference(dir, {
        figmaSeedReference: secondUrl,
        originalDesignIntent: "different intent text"
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.reused).toBe(true);
      expect(second.record.id).toBe(first.record.id);
      expect(typeof second.event_id).toBe("string");
      expect(second.event_id).toBe(first.event_id);
      // Stored URL stays the first verbatim registration.
      expect(second.record.figma_seed_reference).toBe(firstUrl);
      expect(second.record.original_design_intent).toBe(INTENT);

      // Exactly one audit event — reuse must not mint a duplicate.
      const seedEvents = listEvents(dir, "seed_reference_registered");
      expect(seedEvents.length).toBe(1);
      expect(seedEvents[0].event_id).toBe(first.event_id);

      // Returned event_id must exist in events table.
      const db = openProjectDb(dir);
      try {
        const event = db
          .prepare("SELECT event_id FROM events WHERE event_id = ?")
          .get(second.event_id) as { event_id: string } | undefined;
        expect(event?.event_id).toBe(second.event_id);

        const rows = db
          .prepare("SELECT id, file_key, node_id FROM seed_references")
          .all() as Array<{ id: string; file_key: string; node_id: string }>;
        expect(rows.length).toBe(1);
        expect(rows[0].file_key).toBe("AbCdEf");
        expect(rows[0].node_id).toBe("0:81");
      } finally {
        closeProjectDb(db);
      }

      // Different node → new seed.
      const other = registerSeedReference(dir, {
        figmaSeedReference:
          "https://www.figma.com/design/AbCdEf/Checkout?node-id=1-2&t=ccc-11",
        originalDesignIntent: INTENT
      });
      expect(other.ok).toBe(true);
      if (!other.ok) return;
      expect(other.reused).toBeUndefined();
      expect(other.record.id).not.toBe(first.record.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("parseFigmaSeedIdentity normalizes node-id dashes (re-export)", () => {
    const a = parseFigmaSeedIdentity(
      "https://www.figma.com/design/AbCdEf/X?node-id=0-81&t=foo"
    );
    const b = parseFigmaSeedIdentity(
      "https://www.figma.com/design/AbCdEf/X?node-id=0:81"
    );
    expect(a).toEqual({ fileKey: "AbCdEf", nodeId: "0:81" });
    expect(b).toEqual({ fileKey: "AbCdEf", nodeId: "0:81" });
    expect(figmaSeedIdentitiesEqual(a!, b!)).toBe(true);
  });

  test("HTTP write policy rejects registeredVia ui; agent/omitted resolve to agent", () => {
    expect(resolveHttpRegisteredVia("ui")).toEqual({
      ok: false,
      reason: "ui_registration_disabled"
    });
    expect(resolveHttpRegisteredVia("agent")).toEqual({
      ok: true,
      registeredVia: "agent"
    });
    expect(resolveHttpRegisteredVia(undefined)).toEqual({
      ok: true,
      registeredVia: "agent"
    });
    expect(resolveHttpRegisteredVia("other")).toEqual({
      ok: true,
      registeredVia: "agent"
    });
  });

  test("legacy lib registerSeedReference still accepts registeredVia ui (read-compat)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-seed-legacy-ui-"));
    try {
      const res = registerSeedReference(dir, {
        figmaSeedReference: VALID,
        originalDesignIntent: INTENT,
        registeredVia: "ui"
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.record.registered_via).toBe("ui");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("UNIQUE(file_key, node_id): two connections cannot insert duplicate identity rows", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-seed-unique-"));
    try {
      initializeProjectDb(dir);
      const dbPath = getProjectDbPath(dir);

      const connA = new DatabaseSync(dbPath);
      const connB = new DatabaseSync(dbPath);
      try {
        // busy_timeout=0: second connection fails immediately instead of
        // blocking the same thread (which would deadlock with an open txn).
        connA.exec("PRAGMA busy_timeout = 0");
        connB.exec("PRAGMA busy_timeout = 0");

        connA.exec("BEGIN IMMEDIATE");
        connA
          .prepare(
            `INSERT INTO seed_references
             (id, figma_seed_reference, original_design_intent, created_at, registered_via, file_key, node_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            "race-a",
            "https://www.figma.com/design/RaceKey/X?node-id=1-1&t=a",
            INTENT,
            new Date().toISOString(),
            "agent",
            "RaceKey",
            "1:1"
          );

        // Contending write while A holds the lock.
        expect(() =>
          connB
            .prepare(
              `INSERT INTO seed_references
               (id, figma_seed_reference, original_design_intent, created_at, registered_via, file_key, node_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              "race-b",
              "https://www.figma.com/design/RaceKey/X?node-id=1:1&t=b",
              "other intent",
              new Date().toISOString(),
              "agent",
              "RaceKey",
              "1:1"
            )
        ).toThrow(/busy|locked/i);

        connA.exec("COMMIT");

        // After A commits, UNIQUE rejects the duplicate identity.
        expect(() =>
          connB
            .prepare(
              `INSERT INTO seed_references
               (id, figma_seed_reference, original_design_intent, created_at, registered_via, file_key, node_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              "race-b",
              "https://www.figma.com/design/RaceKey/X?node-id=1:1&t=b",
              "other intent",
              new Date().toISOString(),
              "agent",
              "RaceKey",
              "1:1"
            )
        ).toThrow(/unique|constraint/i);

        const count = (
          connA
            .prepare(
              `SELECT COUNT(*) AS c FROM seed_references
               WHERE file_key = ? AND node_id = ?`
            )
            .get("RaceKey", "1:1") as { c: number }
        ).c;
        expect(count).toBe(1);
      } finally {
        try {
          connA.close();
        } catch {
          /* ignore */
        }
        try {
          connB.close();
        } catch {
          /* ignore */
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("two-connection ON CONFLICT race leaves a single seed row and one audit event", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-seed-onconflict-"));
    try {
      initializeProjectDb(dir);
      const dbPath = getProjectDbPath(dir);
      const urlA =
        "https://www.figma.com/design/RaceOC/X?node-id=3-3&t=aaa";
      const urlB =
        "https://www.figma.com/design/RaceOC/X?node-id=3:3&t=bbb";

      const insertSql = `INSERT INTO seed_references
        (id, figma_seed_reference, original_design_intent, created_at, registered_via, file_key, node_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_key, node_id) DO NOTHING`;

      const connA = new DatabaseSync(dbPath);
      const connB = new DatabaseSync(dbPath);
      try {
        connA.exec("PRAGMA busy_timeout = 0");
        connB.exec("PRAGMA busy_timeout = 0");

        connA.exec("BEGIN IMMEDIATE");
        const aResult = connA
          .prepare(insertSql)
          .run(
            "oc-a",
            urlA,
            INTENT,
            new Date().toISOString(),
            "agent",
            "RaceOC",
            "3:3"
          );
        expect(aResult.changes).toBe(1);
        // Mirror production: first writer also records the audit event in-txn.
        logEventOnDb(connA, "seed_reference_registered", {
          seed_reference_id: "oc-a",
          figma_seed_reference: urlA,
          original_design_intent: INTENT,
          registered_via: "agent"
        });

        // Contending connection cannot take the write lock while A is open.
        expect(() => {
          connB.exec("BEGIN IMMEDIATE");
        }).toThrow(/busy|locked/i);

        connA.exec("COMMIT");

        // After commit, ON CONFLICT DO NOTHING → zero changes, first URL kept.
        connB.exec("BEGIN IMMEDIATE");
        const after = connB.prepare(insertSql).run(
          "oc-b",
          urlB,
          "competing",
          new Date().toISOString(),
          "agent",
          "RaceOC",
          "3:3"
        );
        expect(after.changes).toBe(0);
        // Conflict path must NOT insert a second audit event.
        connB.exec("COMMIT");

        const count = (
          connA
            .prepare(
              `SELECT COUNT(*) AS c FROM seed_references
               WHERE file_key = ? AND node_id = ?`
            )
            .get("RaceOC", "3:3") as { c: number }
        ).c;
        expect(count).toBe(1);
        const row = connA
          .prepare(
            `SELECT id, figma_seed_reference FROM seed_references
             WHERE file_key = ? AND node_id = ?`
          )
          .get("RaceOC", "3:3") as {
          id: string;
          figma_seed_reference: string;
        };
        expect(row.id).toBe("oc-a");
        expect(row.figma_seed_reference).toBe(urlA);

        const eventCount = (
          connA
            .prepare(
              `SELECT COUNT(*) AS c FROM events
               WHERE type = 'seed_reference_registered'
                 AND json_extract(payload, '$.seed_reference_id') = 'oc-a'`
            )
            .get() as { c: number }
        ).c;
        expect(eventCount).toBe(1);
      } finally {
        try {
          connA.close();
        } catch {
          /* ignore */
        }
        try {
          connB.close();
        } catch {
          /* ignore */
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("registerSeedReference conflict returns reused with real event_id", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-seed-reuse-event-"));
    try {
      // Pre-insert via the same ON CONFLICT path production uses, with an event.
      const firstUrl =
        "https://www.figma.com/design/ReuseKey/X?node-id=4-4&t=first";
      withProjectTransaction(dir, (db) => {
        db.prepare(
          `INSERT INTO seed_references
           (id, figma_seed_reference, original_design_intent, created_at, registered_via, file_key, node_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          "pre-1",
          firstUrl,
          INTENT,
          "2020-01-01T00:00:00.000Z",
          "agent",
          "ReuseKey",
          "4:4"
        );
        return logEventOnDb(db, "seed_reference_registered", {
          seed_reference_id: "pre-1",
          figma_seed_reference: firstUrl,
          original_design_intent: INTENT,
          registered_via: "agent"
        });
      });

      const second = registerSeedReference(dir, {
        figmaSeedReference:
          "https://www.figma.com/design/ReuseKey/X?node-id=4:4&t=second",
        originalDesignIntent: "should not replace"
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.reused).toBe(true);
      expect(second.record.id).toBe("pre-1");
      expect(second.record.figma_seed_reference).toBe(firstUrl);
      expect(second.record.original_design_intent).toBe(INTENT);
      expect(second.record.file_key).toBe("ReuseKey");
      expect(second.record.node_id).toBe("4:4");

      const db = openProjectDb(dir);
      try {
        const event = db
          .prepare("SELECT event_id FROM events WHERE event_id = ?")
          .get(second.event_id) as { event_id: string } | undefined;
        expect(event?.event_id).toBe(second.event_id);
        const count = (
          db.prepare("SELECT COUNT(*) AS c FROM seed_references").get() as {
            c: number;
          }
        ).c;
        expect(count).toBe(1);
        const eventCount = (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM events
               WHERE type = 'seed_reference_registered'`
            )
            .get() as { c: number }
        ).c;
        expect(eventCount).toBe(1);
      } finally {
        closeProjectDb(db);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
