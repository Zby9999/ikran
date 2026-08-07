// capture_rule_screenshot — the Runtime-owned rule-capture screenshot behind
// the MCP tool of the same name. The browser, surface lookup, filesystem and
// clock are all injected (RuleCaptureDeps), so these tests run without
// Playwright: every failure path resolves quietly with a typed reason and
// leaves no partial artifact behind.

import path from "node:path";
import { expect, test, vi } from "vitest";

import {
  captureRuleScreenshot,
  RULE_CAPTURE_ANNOTATION_STYLE,
  type CaptureRuleScreenshotInput,
  type RuleCaptureDeps
} from "../../lib/runtime/rule-capture";

const PROJECT_PATH = "/tmp/ikran-rule-capture-project";
const SURFACE_ID = "surface-1";
const PREVIEW_URL = "http://127.0.0.1:4300";
const NOW_MS = 1_754_430_000_000;
const PAGE_SIZE = { width: 1440, height: 3000 };

type CapturedCalls = {
  viewport: { width: number; height: number } | null;
  goto: { url: string; options: unknown } | null;
  evaluateArgs: unknown[];
  screenshotOptions: unknown;
  closed: boolean;
  writes: Array<{ absolutePath: string; bytes: Buffer }>;
};

function deps(
  calls: CapturedCalls,
  overrides: Partial<RuleCaptureDeps> = {}
): RuleCaptureDeps {
  const page = {
    setViewportSize: vi.fn(async (size: { width: number; height: number }) => {
      calls.viewport = size;
    }),
    goto: vi.fn(async (url: string, options: unknown) => {
      calls.goto = { url, options };
    }),
    // First evaluate measures the full page; a second one (annotations only)
    // injects the overlay divs and receives the pixel rects + style.
    evaluate: vi.fn(async (_fn: unknown, arg?: unknown) => {
      calls.evaluateArgs.push(arg);
      return calls.evaluateArgs.length === 1 ? PAGE_SIZE : undefined;
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
    resolveSurface: () => ({ ok: true as const, previewUrl: PREVIEW_URL }),
    writeArtifact: (absolutePath, bytes) => {
      calls.writes.push({ absolutePath, bytes });
    },
    sleep: async () => {},
    now: () => NOW_MS,
    ...overrides
  };
}

function freshCalls(): CapturedCalls {
  return {
    viewport: null,
    goto: null,
    evaluateArgs: [],
    screenshotOptions: null,
    closed: false,
    writes: []
  };
}

const BASE_INPUT: CaptureRuleScreenshotInput = { surfaceId: SURFACE_ID };

test("captures with crop + annotations: exact clip math, overlay style, output path", async () => {
  const calls = freshCalls();

  const result = await captureRuleScreenshot(
    PROJECT_PATH,
    {
      ...BASE_INPUT,
      fileName: "grid-page.png",
      crop: { x: 0.25, y: 0.5, width: 0.5, height: 0.25 },
      annotations: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }]
    },
    deps(calls)
  );

  expect(result).toEqual({
    ok: true,
    artifactPath: "design-system/captures/grid-page.png"
  });
  expect(calls.viewport).toEqual({ width: 1440, height: 900 });
  expect(calls.goto).toEqual({
    url: PREVIEW_URL,
    // `load`, never networkidle — a dev server's HMR socket never idles.
    options: { waitUntil: "load", timeout: 15_000 }
  });
  // Normalized rects convert against the measured full page (1440 x 3000).
  expect(calls.evaluateArgs).toEqual([
    undefined, // the page-measure call takes no argument
    {
      style: RULE_CAPTURE_ANNOTATION_STYLE,
      rects: [{ left: 144, top: 600, width: 432, height: 1200 }]
    }
  ]);
  expect(calls.screenshotOptions).toEqual({
    type: "png",
    fullPage: true,
    clip: { x: 360, y: 1500, width: 720, height: 750 }
  });
  expect(calls.closed).toBe(true);
  expect(calls.writes).toEqual([
    {
      absolutePath: path.join(
        PROJECT_PATH,
        "design-system",
        "captures",
        "grid-page.png"
      ),
      bytes: Buffer.from("png-bytes")
    }
  ]);
});

test("the baked overlay style matches the design-system browser capture mark", () => {
  expect(RULE_CAPTURE_ANNOTATION_STYLE).toBe(
    "position:absolute; border:1px solid #19d122; border-radius:2px; " +
      "box-shadow:0 0 0 1px rgb(255 255 255 / 70%); pointer-events:none; " +
      "z-index:2147483647; background:transparent;"
  );
});

test("defaults: no crop/annotations captures the full page with a timestamped name", async () => {
  const calls = freshCalls();

  const result = await captureRuleScreenshot(
    PROJECT_PATH,
    BASE_INPUT,
    deps(calls)
  );

  const fileName = `rule-capture-${NOW_MS}.png`;
  expect(result).toEqual({
    ok: true,
    artifactPath: `design-system/captures/${fileName}`
  });
  // Measure only — no overlay injection without annotations.
  expect(calls.evaluateArgs).toEqual([undefined]);
  expect(calls.screenshotOptions).toEqual({ type: "png", fullPage: true });
  expect(calls.writes).toEqual([
    {
      absolutePath: path.join(
        PROJECT_PATH,
        "design-system",
        "captures",
        fileName
      ),
      bytes: Buffer.from("png-bytes")
    }
  ]);
});

test("fileName is sanitized to a basename; empty falls back to the default", async () => {
  const calls = freshCalls();

  const nested = await captureRuleScreenshot(
    PROJECT_PATH,
    { ...BASE_INPUT, fileName: "../captures\\evil/foo.png" },
    deps(calls)
  );
  expect(nested).toEqual({
    ok: true,
    artifactPath: "design-system/captures/foo.png"
  });

  const blank = await captureRuleScreenshot(
    PROJECT_PATH,
    { ...BASE_INPUT, fileName: "  " },
    deps(freshCalls())
  );
  expect(blank).toEqual({
    ok: true,
    artifactPath: `design-system/captures/rule-capture-${NOW_MS}.png`
  });
});

test("an unknown surface resolves quietly without launching a browser", async () => {
  const calls = freshCalls();
  let launched = false;

  const result = await captureRuleScreenshot(
    PROJECT_PATH,
    BASE_INPUT,
    deps(calls, {
      resolveSurface: () => ({ ok: false as const, reason: "surface_not_found" }),
      launchBrowser: async () => {
        launched = true;
        throw new Error("unreachable");
      }
    })
  );

  expect(result).toEqual({ ok: false, reason: "surface_not_found" });
  expect(launched).toBe(false);
  expect(calls.writes).toEqual([]);
});

test("a surface without a usable preview URL fails as preview_unavailable", async () => {
  const calls = freshCalls();

  const result = await captureRuleScreenshot(
    PROJECT_PATH,
    BASE_INPUT,
    deps(calls, {
      resolveSurface: () => ({ ok: false as const, reason: "preview_unavailable" })
    })
  );

  expect(result).toEqual({ ok: false, reason: "preview_unavailable" });
  expect(calls.writes).toEqual([]);
});

test("a launch failure resolves quietly and touches nothing", async () => {
  const calls = freshCalls();

  const result = await captureRuleScreenshot(
    PROJECT_PATH,
    BASE_INPUT,
    deps(calls, {
      launchBrowser: async () => {
        throw new Error("playwright-core not installed");
      }
    })
  );

  expect(result).toEqual({ ok: false, reason: "browser_unavailable" });
  expect(calls.writes).toEqual([]);
});

test("a navigation failure still closes the browser and writes nothing", async () => {
  const calls = freshCalls();
  const failing = deps(calls, {
    launchBrowser: async () => ({
      newPage: async () => ({
        setViewportSize: async () => {},
        goto: async () => {
          throw new Error("net::ERR_CONNECTION_REFUSED");
        },
        evaluate: async () => PAGE_SIZE,
        screenshot: async () => Buffer.from("")
      }),
      close: async () => {
        calls.closed = true;
      }
    })
  });

  const result = await captureRuleScreenshot(PROJECT_PATH, BASE_INPUT, failing);

  expect(result).toEqual({ ok: false, reason: "capture_failed" });
  expect(calls.closed).toBe(true);
  expect(calls.writes).toEqual([]);
});
