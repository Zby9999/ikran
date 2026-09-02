// Runtime-owned screenshot + annotation capture for design-system rule
// provenance (capture_rule_screenshot).
//
// Agents updating layout / components.spec rules used to reuse stale capture
// files because no tool could produce a fresh one. This module screenshots a
// prototype surface's preview URL in headless Chromium, optionally crops the
// result and bakes green annotation rectangles into the PNG (via DOM overlay
// divs injected before the screenshot — no image library), then writes it
// under `design-system/captures/` so the Agent can declare it in a rule's
// `sourceCaptures`.
//
// `crop` and each annotation rect are normalized floats in [0, 1] relative to
// the FULL page (x/y = top-left, width/height = fraction of the page); they
// convert against the measured document scroll size. Typical usage is two
// passes: capture plain, inspect, capture again with crop + annotations.
//
// `playwright-core` is a direct Runtime dependency but is imported dynamically
// so ordinary MCP commands do not eagerly initialize browser control. All host
// effects go through `RuleCaptureDeps` so unit tests exercise the flow without
// a browser. Never throws: failures resolve quietly with a typed reason.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { launchIkranChromium } from "./chromium-runtime";
import { getPrototypeSurface } from "./prototype-surface";

const RULE_CAPTURE_DIR = path.posix.join("design-system", "captures");
const SCREENSHOT_VIEWPORT = { width: 1440, height: 900 };
const SCREENSHOT_GOTO_TIMEOUT_MS = 15_000;
/** Settle time after `load` for client-side rendering to paint. */
const SCREENSHOT_RENDER_WAIT_MS = 1_500;

/** Green highlight mark, matching the design-system browser's capture
 * annotation (components/workbench/design-system-browser.css). */
export const RULE_CAPTURE_ANNOTATION_STYLE =
  "position:absolute; border:1px solid #19d122; border-radius:2px; " +
  "box-shadow:0 0 0 1px rgb(255 255 255 / 70%); pointer-events:none; " +
  "z-index:2147483647; background:transparent;";

/** Normalized rect: fractions of the FULL page, x/y = top-left. */
export interface RuleCaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureRuleScreenshotInput {
  surfaceId: string;
  /** Output file name under design-system/captures/ (basename only). */
  fileName?: string;
  /** Normalized crop against the full page; absent captures everything. */
  crop?: RuleCaptureRect;
  /** Normalized highlight rects baked into the PNG as green overlays. */
  annotations?: RuleCaptureRect[];
}

/** Minimal page surface used by the capture — Playwright's Page satisfies it. */
export interface RuleCapturePage {
  setViewportSize(size: { width: number; height: number }): Promise<unknown>;
  goto(
    url: string,
    options: { waitUntil: "load"; timeout: number }
  ): Promise<unknown>;
  evaluate(fn: unknown, arg?: unknown): Promise<unknown>;
  screenshot(options: {
    type: "png";
    fullPage: boolean;
    clip?: { x: number; y: number; width: number; height: number };
  }): Promise<Buffer>;
}

export interface RuleCaptureBrowser {
  newPage(): Promise<RuleCapturePage>;
  close(): Promise<unknown>;
}

export type RuleCaptureSurfaceResolution =
  | { ok: true; previewUrl: string }
  | { ok: false; reason: "surface_not_found" | "preview_unavailable" };

export interface RuleCaptureDeps {
  /** Launch a headless browser; may reject when Playwright is unavailable. */
  launchBrowser(): Promise<RuleCaptureBrowser>;
  /** Resolve the surface's preview URL from the surface record. */
  resolveSurface(
    projectPath: string,
    surfaceId: string
  ): RuleCaptureSurfaceResolution;
  /** Write the PNG bytes at an absolute path, creating directories. */
  writeArtifact(absolutePath: string, bytes: Buffer): void;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export type CaptureRuleScreenshotResult =
  | { ok: true; artifactPath: string }
  | { ok: false; reason: string };

export const defaultRuleCaptureDeps: RuleCaptureDeps = {
  async launchBrowser() {
    return (await launchIkranChromium()) as unknown as RuleCaptureBrowser;
  },
  resolveSurface(projectPath, surfaceId) {
    const surface = getPrototypeSurface(projectPath, surfaceId);
    if (surface === null) return { ok: false, reason: "surface_not_found" };
    if (surface.preview_url.trim().length === 0) {
      return { ok: false, reason: "preview_unavailable" };
    }
    return { ok: true, previewUrl: surface.preview_url };
  },
  writeArtifact(absolutePath, bytes) {
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, bytes);
  },
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
  now() {
    return Date.now();
  }
};

/** Basename only — path separators are stripped, never honored. */
function sanitizeFileName(fileName: string | undefined, now: number): string {
  const fallback = `rule-capture-${now}.png`;
  if (typeof fileName !== "string") return fallback;
  const base = fileName.trim().split(/[\\/]/).pop() ?? "";
  return base.length > 0 ? base : fallback;
}

/** Normalized rect → CSS pixels against the measured full page. */
function toPagePixels(rect: RuleCaptureRect, page: { width: number; height: number }) {
  return {
    x: Math.round(rect.x * page.width),
    y: Math.round(rect.y * page.height),
    width: Math.round(rect.width * page.width),
    height: Math.round(rect.height * page.height)
  };
}

/**
 * Capture one prototype surface rendering for a design-system rule. The page
 * is measured after load, annotation overlays are injected as absolutely
 * positioned divs, and the full-page screenshot is clipped to `crop` when
 * given (Playwright `clip` is relative to the page origin, so it composes
 * with `fullPage: true`). Never throws.
 */
export async function captureRuleScreenshot(
  projectPath: string,
  input: CaptureRuleScreenshotInput,
  deps: RuleCaptureDeps = defaultRuleCaptureDeps
): Promise<CaptureRuleScreenshotResult> {
  const surface = deps.resolveSurface(projectPath, input.surfaceId);
  if (!surface.ok) return { ok: false, reason: surface.reason };

  let browser: RuleCaptureBrowser;
  try {
    browser = await deps.launchBrowser();
  } catch {
    return { ok: false, reason: "browser_unavailable" };
  }

  let bytes: Buffer;
  try {
    const page = await browser.newPage();
    await page.setViewportSize(SCREENSHOT_VIEWPORT);
    await page.goto(surface.previewUrl, {
      waitUntil: "load",
      timeout: SCREENSHOT_GOTO_TIMEOUT_MS
    });
    await deps.sleep(SCREENSHOT_RENDER_WAIT_MS);
    const measured = (await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight
    }))) as { width: number; height: number };

    if (input.annotations !== undefined && input.annotations.length > 0) {
      const rects = input.annotations.map((rect) => {
        const px = toPagePixels(rect, measured);
        return { left: px.x, top: px.y, width: px.width, height: px.height };
      });
      await page.evaluate(
        (payload: {
          style: string;
          rects: Array<{ left: number; top: number; width: number; height: number }>;
        }) => {
          for (const rect of payload.rects) {
            const overlay = document.createElement("div");
            overlay.style.cssText =
              payload.style +
              ` left:${rect.left}px; top:${rect.top}px;` +
              ` width:${rect.width}px; height:${rect.height}px;`;
            document.body.appendChild(overlay);
          }
        },
        { style: RULE_CAPTURE_ANNOTATION_STYLE, rects }
      );
    }

    bytes = await page.screenshot({
      type: "png",
      fullPage: true,
      ...(input.crop === undefined ? {} : { clip: toPagePixels(input.crop, measured) })
    });
  } catch {
    return { ok: false, reason: "capture_failed" };
  } finally {
    try {
      await browser.close();
    } catch {
      // The browser is already gone — nothing to clean up.
    }
  }

  const fileName = sanitizeFileName(input.fileName, deps.now());
  // Project-relative with forward slashes, matching the evidence-media
  // convention so a rule's sourceCaptures can declare it verbatim.
  const relativePath = path.posix.join(RULE_CAPTURE_DIR, fileName);
  try {
    deps.writeArtifact(path.join(projectPath, RULE_CAPTURE_DIR, fileName), bytes);
  } catch {
    return { ok: false, reason: "write_failed" };
  }

  return { ok: true, artifactPath: relativePath };
}
