// Issue 30 screenshot placeholder — the fire-and-forget Playwright capture
// behind recordPreview. The browser, filesystem, persistence and clock are all
// injected (PrototypeScreenshotDeps), so these tests run without Playwright:
// capture is best-effort and every failure path resolves quietly, leaving the
// previously captured bitmap in place.

import path from "node:path";
import { expect, test, vi } from "vitest";

import {
  capturePrototypeSurfaceScreenshot,
  type PrototypeScreenshotDeps
} from "../../lib/runtime/prototype-screenshot";

const PROJECT_PATH = "/tmp/ikran-screenshot-project";
const SURFACE_ID = "surface-1";
const PREVIEW_URL = "http://127.0.0.1:4300";
const NOW_MS = 1_754_430_000_000;
const FILE_NAME = `${SURFACE_ID}-1133.png`;
const RELATIVE_PATH = `.ikran/artifacts/prototype-media/${FILE_NAME}`;

type CapturedCalls = {
  viewport: { width: number; height: number } | null;
  goto: { url: string; options: unknown } | null;
  evaluated: boolean;
  screenshotOptions: unknown;
  closed: boolean;
  preflightUrl: string | null;
  writes: Array<{ absolutePath: string; bytes: Buffer }>;
  persists: Array<{
    projectPath: string;
    surfaceId: string;
    artifactPath: string;
    expectedGeneration?: number;
  }>;
  removals: string[];
  listedArtifacts: string[];
};

function deps(
  calls: CapturedCalls,
  overrides: Partial<PrototypeScreenshotDeps> = {}
): PrototypeScreenshotDeps {
  const page = {
    setViewportSize: vi.fn(async (size: { width: number; height: number }) => {
      calls.viewport = size;
    }),
    goto: vi.fn(async (url: string, options: unknown) => {
      calls.goto = { url, options };
    }),
    evaluate: vi.fn(async () => {
      calls.evaluated = true;
      return undefined;
    }),
    screenshot: vi.fn(async (options: unknown) => {
      calls.screenshotOptions = options;
      return Buffer.from("png-bytes");
    })
  };
  return {
    launchBrowser: async () => ({
      newPage: async () => page,
      close: async () => {
        calls.closed = true;
      }
    }),
    fetchStatus: async (url) => {
      calls.preflightUrl = url;
      return { ok: true as const, status: 200 };
    },
    writeArtifact: (absolutePath, bytes) => {
      calls.writes.push({ absolutePath, bytes });
    },
    persist: (projectPath, surfaceId, artifactPath, expectedGeneration) => {
      calls.persists.push({
        projectPath,
        surfaceId,
        artifactPath,
        expectedGeneration
      });
      return {
        ok: true as const,
        previous_artifact_path:
          ".ikran/artifacts/prototype-media/surface-1-old.png"
      };
    },
    removeArtifact: (absolutePath) => {
      calls.removals.push(absolutePath);
    },
    listArtifacts: () => calls.listedArtifacts,
    sleep: async () => {},
    now: () => NOW_MS,
    ...overrides
  };
}

function freshCalls(): CapturedCalls {
  return {
    viewport: null,
    goto: null,
    evaluated: false,
    screenshotOptions: null,
    closed: false,
    preflightUrl: null,
    writes: [],
    persists: [],
    removals: [],
    listedArtifacts: [
      "surface-1-old.png",
      "surface-1-1754430000000.png",
      "surface-2-old.png"
    ]
  };
}

test("captures the page and persists the project-relative artifact path", async () => {
  const calls = freshCalls();

  const result = await capturePrototypeSurfaceScreenshot(
    PROJECT_PATH,
    SURFACE_ID,
    PREVIEW_URL,
    deps(calls)
  );

  expect(result).toEqual({ ok: true, artifact_path: RELATIVE_PATH });
  expect(calls.preflightUrl).toBe(PREVIEW_URL);
  expect(calls.evaluated).toBe(true);
  expect(calls.viewport).toEqual({ width: 1133, height: 900 });
  expect(calls.goto).toEqual({
    url: PREVIEW_URL,
    // `load`, never networkidle — a dev server's HMR socket never idles.
    options: { waitUntil: "load", timeout: 15_000 }
  });
  expect(calls.screenshotOptions).toEqual({ type: "png", fullPage: true });
  expect(calls.closed).toBe(true);
  expect(calls.writes).toEqual([
    {
      absolutePath: path.join(
        PROJECT_PATH,
        ".ikran",
        "artifacts",
        "prototype-media",
        FILE_NAME
      ),
      bytes: Buffer.from("png-bytes")
    }
  ]);
  expect(calls.persists).toEqual([
    {
      projectPath: PROJECT_PATH,
      surfaceId: SURFACE_ID,
      artifactPath: RELATIVE_PATH,
      expectedGeneration: undefined
    }
  ]);
  expect(calls.removals).toEqual([
    path.join(
      PROJECT_PATH,
      ".ikran",
      "artifacts",
      "prototype-media",
      "surface-1-old.png"
    ),
    path.join(
      PROJECT_PATH,
      ".ikran",
      "artifacts",
      "prototype-media",
      "surface-1-1754430000000.png"
    )
  ]);
});

test("allows an explicit viewport override for lower-level capture callers", async () => {
  const calls = freshCalls();
  const result = await capturePrototypeSurfaceScreenshot(
    PROJECT_PATH,
    SURFACE_ID,
    PREVIEW_URL,
    deps(calls),
    { viewportWidth: 1728 }
  );

  expect(result).toEqual({
    ok: true,
    artifact_path:
      ".ikran/artifacts/prototype-media/surface-1-1728.png"
  });
  expect(calls.viewport).toEqual({ width: 1728, height: 900 });
  expect(calls.persists[0]?.artifactPath).toBe(
    ".ikran/artifacts/prototype-media/surface-1-1728.png"
  );
});

test("passes expectedGeneration through persist for compare-and-set", async () => {
  const calls = freshCalls();
  const result = await capturePrototypeSurfaceScreenshot(
    PROJECT_PATH,
    SURFACE_ID,
    PREVIEW_URL,
    deps(calls),
    { expectedGeneration: 4 }
  );
  expect(result.ok).toBe(true);
  expect(calls.persists[0]?.expectedGeneration).toBe(4);
});

test("a generation mismatch keeps the previous screenshot path in the DB", async () => {
  const calls = freshCalls();
  const result = await capturePrototypeSurfaceScreenshot(
    PROJECT_PATH,
    SURFACE_ID,
    PREVIEW_URL,
    deps(calls, {
      persist: () => ({ ok: false, reason: "generation_mismatch" })
    }),
    { expectedGeneration: 1 }
  );
  expect(result).toEqual({ ok: false, reason: "generation_mismatch" });
  expect(calls.writes).toHaveLength(1);
});

test("HTTP 5xx skips the browser and does not persist a failed image", async () => {
  const calls = freshCalls();
  const result = await capturePrototypeSurfaceScreenshot(
    PROJECT_PATH,
    SURFACE_ID,
    PREVIEW_URL,
    deps(calls, {
      fetchStatus: async () => ({ ok: true, status: 500 })
    })
  );
  expect(result).toEqual({ ok: false, reason: "http_500" });
  expect(calls.writes).toEqual([]);
  expect(calls.persists).toEqual([]);
  expect(calls.closed).toBe(false);
});

test("an unreachable preview skips the browser and keeps the old bitmap", async () => {
  const calls = freshCalls();
  const result = await capturePrototypeSurfaceScreenshot(
    PROJECT_PATH,
    SURFACE_ID,
    PREVIEW_URL,
    deps(calls, {
      fetchStatus: async () => ({ ok: false })
    })
  );
  expect(result).toEqual({ ok: false, reason: "preview_unreachable" });
  expect(calls.writes).toEqual([]);
  expect(calls.persists).toEqual([]);
});

test("a launch failure resolves quietly and touches nothing", async () => {
  const calls = freshCalls();

  const result = await capturePrototypeSurfaceScreenshot(
    PROJECT_PATH,
    SURFACE_ID,
    PREVIEW_URL,
    deps(calls, {
      launchBrowser: async () => {
        throw new Error("playwright-core not installed");
      }
    })
  );

  expect(result).toEqual({ ok: false, reason: "browser_unavailable" });
  expect(calls.writes).toEqual([]);
  expect(calls.persists).toEqual([]);
});

test("a navigation failure still closes the browser and keeps the old bitmap", async () => {
  const calls = freshCalls();
  const failing = deps(calls, {
    launchBrowser: async () => ({
      newPage: async () => ({
        setViewportSize: async () => {},
        goto: async () => {
          throw new Error("net::ERR_CONNECTION_REFUSED");
        },
        evaluate: async () => undefined,
        screenshot: async () => Buffer.from("")
      }),
      close: async () => {
        calls.closed = true;
      }
    })
  });

  const result = await capturePrototypeSurfaceScreenshot(
    PROJECT_PATH,
    SURFACE_ID,
    PREVIEW_URL,
    failing
  );

  expect(result).toEqual({ ok: false, reason: "capture_failed" });
  expect(calls.closed).toBe(true);
  expect(calls.writes).toEqual([]);
  expect(calls.persists).toEqual([]);
});
