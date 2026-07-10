// Unit tests for register_seed_reference's best-effort audit semantics (Issue 02/03).
//
// Pure Node — no MCP/Next spawn. Proves the record (source of truth) is saved
// and the call returns ok:true EVEN WHEN the best-effort audit event write
// throws — so a caller must NOT retry (retrying would duplicate the record).
// Also covers the happy path (record + audit event both written).

import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { registerSeedReference, parseFigmaSeedIdentity, figmaSeedIdentitiesEqual } from "../lib/runtime/seed-reference";
import { listEvents } from "../lib/runtime/events";

const VALID = "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";
const INTENT = "checkout trust signals";

test.describe("register_seed_reference — best-effort audit (unit)", () => {
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
      expect(res.audit_warning).toBeUndefined();
      expect(res.record.figma_seed_reference).toBe(VALID);
      expect(res.record.original_design_intent).toBe(INTENT);

      // audit event landed in SQLite + jsonl
      const ev = listEvents(dir, "seed_reference_registered");
      expect(ev.length).toBe(1);
      expect(existsSync(path.join(dir, ".ikran", "events.jsonl"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("audit write failure: record still saved; call returns ok:true + event_id:null + audit_warning (no retry → no duplicate)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-seed-unit-audit-"));
    try {
      // Pre-create .ikran and make `events.jsonl` a DIRECTORY so logEvent's
      // appendFileSync throws (EISDIR) — models an audit-write I/O failure AFTER
      // the record is committed. (This injection fails the JSONL step; the
      // SQLite events row may still land — the contract under test is the CALL's
      // return, not the event's presence.)
      mkdirSync(path.join(dir, ".ikran"), { recursive: true });
      mkdirSync(path.join(dir, ".ikran", "events.jsonl"));

      const res = registerSeedReference(dir, {
        figmaSeedReference: VALID,
        originalDesignIntent: INTENT
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      // best-effort: audit failed → null event_id + warning, but call SUCCEEDED
      expect(res.event_id).toBeNull();
      expect(res.audit_warning).toBe("event_write_failed");
      expect(res.record.figma_seed_reference).toBe(VALID);

      // source of truth: the record WAS saved despite the audit failure
      // (so a well-behaved caller that sees ok:true will not retry → no duplicate)
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(path.join(dir, ".ikran", "ikran.db"));
      const rows = db
        .prepare("SELECT figma_seed_reference FROM seed_references")
        .all() as Array<{ figma_seed_reference: string }>;
      expect(rows.length).toBe(1);
      expect(rows[0].figma_seed_reference).toBe(VALID);
      db.close();
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

      const second = registerSeedReference(dir, {
        figmaSeedReference: secondUrl,
        originalDesignIntent: "different intent text"
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.reused).toBe(true);
      expect(second.record.id).toBe(first.record.id);
      // Stored URL stays the first verbatim registration.
      expect(second.record.figma_seed_reference).toBe(firstUrl);

      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(path.join(dir, ".ikran", "ikran.db"));
      const rows = db
        .prepare("SELECT id FROM seed_references")
        .all() as Array<{ id: string }>;
      expect(rows.length).toBe(1);
      db.close();

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

  test("parseFigmaSeedIdentity normalizes node-id dashes", () => {
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
});