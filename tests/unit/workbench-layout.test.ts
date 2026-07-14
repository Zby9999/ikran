// Unit tests for `.ikran/workbench-layout.json` UX persistence (not research data).

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  emptyWorkbenchLayout,
  parseWorkbenchLayout,
  readWorkbenchLayout,
  reconcileWorkbenchLayout,
  writeWorkbenchLayout
} from "../../lib/runtime/workbench-layout";
import { getWorkbenchLayoutPath } from "../../lib/runtime/paths";
import {
  deleteSeedReference,
  registerSeedReference
} from "../../lib/runtime/seed-reference";

const VALID = "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";
const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

describe("workbench-layout — parse / reconcile", () => {
  test("parseWorkbenchLayout accepts version 1 document", () => {
    const parsed = parseWorkbenchLayout({
      version: 1,
      camera: { x: 10, y: -20, z: 0.5 },
      frames: {
        "seed-a": {
          x: 100,
          y: 200,
          w: 380,
          h: 520,
          layoutLocked: true
        }
      }
    });
    expect(parsed).toEqual({
      version: 1,
      camera: { x: 10, y: -20, z: 0.5 },
      frames: {
        "seed-a": {
          x: 100,
          y: 200,
          w: 380,
          h: 520,
          layoutLocked: true
        }
      }
    });
  });

  test("parseWorkbenchLayout rejects bad version / zoom / sizes", () => {
    expect(parseWorkbenchLayout({ version: 2, camera: {}, frames: {} })).toBeNull();
    expect(
      parseWorkbenchLayout({
        version: 1,
        camera: { x: 0, y: 0, z: 0 },
        frames: {}
      })
    ).toEqual({
      version: 1,
      camera: { x: 0, y: 0, z: 1 },
      frames: {}
    });
    expect(
      parseWorkbenchLayout({
        version: 1,
        camera: { x: 0, y: 0, z: 1 },
        frames: { bad: { x: 0, y: 0, w: 0, h: 10, layoutLocked: false } }
      })?.frames
    ).toEqual({});
  });

  test("reconcileWorkbenchLayout drops orphan frame keys", () => {
    const layout = {
      version: 1 as const,
      camera: { x: 1, y: 2, z: 1 },
      frames: {
        keep: { x: 0, y: 0, w: 10, h: 10, layoutLocked: false },
        gone: { x: 1, y: 1, w: 10, h: 10, layoutLocked: true }
      }
    };
    expect(reconcileWorkbenchLayout(layout, new Set(["keep"]))).toEqual({
      version: 1,
      camera: { x: 1, y: 2, z: 1 },
      frames: {
        keep: { x: 0, y: 0, w: 10, h: 10, layoutLocked: false }
      }
    });
  });
});

describe("workbench-layout — disk I/O + reconcile", () => {
  test("malformed disposable layout reports a degraded read", () => {
    const dir = tempDir("ikran-layout-corrupt-");
    const filePath = getWorkbenchLayoutPath(dir);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, "{not-json", "utf8");

    expect(readWorkbenchLayout(dir)).toEqual({
      ok: false,
      reason: "read_failed"
    });
  });

  test("newer layout revisions cannot be overwritten by stale requests", () => {
    const dir = tempDir("ikran-layout-revision-");
    mkdirSync(path.join(dir, ".ikran"), { recursive: true });
    const newest = {
      version: 1 as const,
      camera: { x: 20, y: 0, z: 1 },
      frames: {}
    };
    const stale = {
      version: 1 as const,
      camera: { x: 10, y: 0, z: 1 },
      frames: {}
    };

    expect(writeWorkbenchLayout(dir, newest, 2).ok).toBe(true);
    expect(writeWorkbenchLayout(dir, stale, 1).ok).toBe(true);
    expect(readWorkbenchLayout(dir)).toMatchObject({
      ok: true,
      layout: newest
    });
  });

  test("equal cross-client revisions use server arrival order", () => {
    const dir = tempDir("ikran-layout-equal-revision-");
    mkdirSync(path.join(dir, ".ikran"), { recursive: true });
    const first = {
      version: 1 as const,
      camera: { x: 10, y: 0, z: 1 },
      frames: {}
    };
    const second = {
      version: 1 as const,
      camera: { x: 20, y: 0, z: 1 },
      frames: {}
    };

    expect(writeWorkbenchLayout(dir, first, 1).ok).toBe(true);
    expect(writeWorkbenchLayout(dir, second, 1).ok).toBe(true);
    expect(readWorkbenchLayout(dir)).toMatchObject({
      ok: true,
      layout: second
    });
  });

  test("orphan reconcile preserves revision against a stale in-flight PUT", () => {
    const dir = tempDir("ikran-layout-reconcile-revision-");
    mkdirSync(path.join(dir, ".ikran"), { recursive: true });
    const filePath = getWorkbenchLayoutPath(dir);
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        camera: { x: 20, y: 0, z: 1 },
        frames: {
          orphan: { x: 0, y: 0, w: 10, h: 10, layoutLocked: false }
        },
        writeRevision: 2
      })
    );

    expect(readWorkbenchLayout(dir)).toMatchObject({ ok: true, pruned: true });
    expect(
      writeWorkbenchLayout(
        dir,
        { version: 1, camera: { x: 10, y: 0, z: 1 }, frames: {} },
        1
      ).ok
    ).toBe(true);
    expect(readWorkbenchLayout(dir)).toMatchObject({
      ok: true,
      layout: { camera: { x: 20, y: 0, z: 1 } }
    });
  });

  test("write then read round-trips; PUT prunes unknown seed ids", () => {
    const dir = tempDir("ikran-layout-io-");
    const seeded = registerSeedReference(dir, {
      figmaSeedReference: VALID,
      originalDesignIntent: "intent"
    });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;

    const written = writeWorkbenchLayout(dir, {
      version: 1,
      camera: { x: 40, y: 50, z: 1.25 },
      frames: {
        [seeded.record.id]: {
          x: 500,
          y: 300,
          w: 400,
          h: 600,
          layoutLocked: true
        },
        "orphan-seed": {
          x: 1,
          y: 2,
          w: 3,
          h: 4,
          layoutLocked: false
        }
      }
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.layout.frames["orphan-seed"]).toBeUndefined();
    expect(written.layout.frames[seeded.record.id]).toEqual({
      x: 500,
      y: 300,
      w: 400,
      h: 600,
      layoutLocked: true
    });

    const filePath = getWorkbenchLayoutPath(dir);
    expect(existsSync(filePath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(filePath, "utf8"));
    expect(onDisk.camera.z).toBe(1.25);

    const read = readWorkbenchLayout(dir);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.layout.camera).toEqual({ x: 40, y: 50, z: 1.25 });
    expect(Object.keys(read.layout.frames)).toEqual([seeded.record.id]);
  });

  test("deleteSeedReference removes the frame layout entry", () => {
    const dir = tempDir("ikran-layout-del-");
    const seeded = registerSeedReference(dir, {
      figmaSeedReference: VALID,
      originalDesignIntent: "intent"
    });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;

    writeWorkbenchLayout(dir, {
      version: 1,
      camera: { x: 0, y: 0, z: 1 },
      frames: {
        [seeded.record.id]: {
          x: 10,
          y: 20,
          w: 30,
          h: 40,
          layoutLocked: true
        }
      }
    });

    const deleted = deleteSeedReference(dir, seeded.record.id);
    expect(deleted.ok).toBe(true);

    const read = readWorkbenchLayout(dir);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.layout.frames).toEqual({});
  });

  test("readWorkbenchLayout rewrites file when orphans are present", () => {
    const dir = tempDir("ikran-layout-prune-read-");
    const seeded = registerSeedReference(dir, {
      figmaSeedReference: VALID,
      originalDesignIntent: "intent"
    });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;

    // Bypass writeWorkbenchLayout prune by writing raw JSON with an orphan.
    const filePath = getWorkbenchLayoutPath(dir);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        camera: { x: 0, y: 0, z: 1 },
        frames: {
          [seeded.record.id]: {
            x: 1,
            y: 2,
            w: 3,
            h: 4,
            layoutLocked: false
          },
          ghost: { x: 9, y: 9, w: 9, h: 9, layoutLocked: true }
        }
      }),
      "utf8"
    );

    const read = readWorkbenchLayout(dir);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.pruned).toBe(true);
    expect(read.layout.frames.ghost).toBeUndefined();

    const onDisk = JSON.parse(readFileSync(filePath, "utf8"));
    expect(onDisk.frames.ghost).toBeUndefined();
  });
});
