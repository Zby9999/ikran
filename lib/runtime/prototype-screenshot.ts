// Runtime-captured screenshot for a Prototype Evidence Surface (Issue 30).
//
// When a preview becomes ready, Runtime loads the preview URL in headless
// Chromium and stores a PNG under `.ikran/artifacts/prototype-media/`. The
// Workbench shows that bitmap whenever the surface is not the live one, so the
// canvas reads as a page overview instead of a text placeholder.
//
// Capture is best-effort and fire-and-forget: recordPreview never awaits it,
// and any failure (no Playwright, navigation timeout, write error) resolves
// quietly and leaves the previously captured bitmap in place.
//
// `playwright-core` is a direct Runtime dependency but is imported dynamically
// so ordinary MCP commands do not eagerly initialize browser control. All host
// effects go through `PrototypeScreenshotDeps` so unit tests exercise the flow
// without a browser.

import {
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { getArtifactsDir } from "./paths";
import { setPrototypeSurfaceScreenshot } from "./prototype-surface";
import {
  normalizePrototypeScreenshotViewportWidth,
  prototypeScreenshotFileName,
  PROTOTYPE_SCREENSHOT_DEFAULT_VIEWPORT_WIDTH,
  PROTOTYPE_SCREENSHOT_VIEWPORT_HEIGHT
} from "./prototype-screenshot-shared";

const PROTOTYPE_MEDIA_DIR_NAME = "prototype-media";
const SCREENSHOT_GOTO_TIMEOUT_MS = 15_000;
const SCREENSHOT_PREFLIGHT_TIMEOUT_MS = 5_000;
/** Short settle after fonts and two animation frames — never networkidle. */
const SCREENSHOT_RENDER_WAIT_MS = 400;

/** Minimal page surface used by the capture — Playwright's Page satisfies it. */
export interface PrototypeScreenshotPage {
  setViewportSize(size: { width: number; height: number }): Promise<unknown>;
  goto(
    url: string,
    options: { waitUntil: "load"; timeout: number }
  ): Promise<unknown>;
  evaluate(pageFunction: () => unknown | Promise<unknown>): Promise<unknown>;
  screenshot(options: { type: "png"; fullPage: true }): Promise<Buffer>;
}

export interface PrototypeScreenshotBrowser {
  newPage(): Promise<PrototypeScreenshotPage>;
  close(): Promise<unknown>;
}

export interface PrototypeScreenshotDeps {
  /** Launch a headless browser; may reject when Playwright is unavailable. */
  launchBrowser(): Promise<PrototypeScreenshotBrowser>;
  /** Plain HTTP preflight; ok:false means the preview could not be reached. */
  fetchStatus(
    url: string
  ): Promise<{ ok: true; status: number } | { ok: false }>;
  /** Write the PNG bytes at an absolute path, creating directories. */
  writeArtifact(absolutePath: string, bytes: Buffer): void;
  /** Persist the project-relative artifact path on the surface record. */
  persist(
    projectPath: string,
    surfaceId: string,
    artifactPath: string,
    expectedGeneration?: number
  ):
    | { ok: true; previous_artifact_path: string | null }
    | { ok: false; reason: string };
  /** Remove a superseded managed screenshot after the DB points at the new one. */
  removeArtifact(absolutePath: string): void;
  /** Enumerate managed screenshot filenames for orphan cleanup. */
  listArtifacts(absoluteDirectory: string): string[];
  sleep(ms: number): Promise<void>;
  now(): number;
}

export type PrototypeScreenshotResult =
  | { ok: true; artifact_path: string }
  | { ok: false; reason: string };

export type PrototypeScreenshotOptions = {
  /** CSS viewport width to match the Workbench browser's responsive layout. */
  viewportWidth?: number;
  /**
   * When set, persist is a generation compare-and-set: a newer source
   * revision must not be overwritten by this capture.
   */
  expectedGeneration?: number;
};

export const defaultPrototypeScreenshotDeps: PrototypeScreenshotDeps = {
  async launchBrowser() {
    const { chromium } = await import("playwright-core");
    return (await chromium.launch({
      headless: true
    })) as unknown as PrototypeScreenshotBrowser;
  },
  async fetchStatus(url) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(SCREENSHOT_PREFLIGHT_TIMEOUT_MS),
        redirect: "follow"
      });
      await response.arrayBuffer().catch(() => undefined);
      return { ok: true, status: response.status };
    } catch {
      return { ok: false };
    }
  },
  writeArtifact(absolutePath, bytes) {
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, bytes);
      renameSync(temporaryPath, absolutePath);
    } catch (error) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // The temporary file was never created or was already moved.
      }
      throw error;
    }
  },
  persist(projectPath, surfaceId, artifactPath, expectedGeneration) {
    return setPrototypeSurfaceScreenshot(
      projectPath,
      surfaceId,
      artifactPath,
      expectedGeneration === undefined ? {} : { expectedGeneration }
    );
  },
  removeArtifact(absolutePath) {
    try {
      unlinkSync(absolutePath);
    } catch {
      // Cleanup is best-effort; the DB already points at the valid new image.
    }
  },
  listArtifacts(absoluteDirectory) {
    try {
      return readdirSync(absoluteDirectory);
    } catch {
      return [];
    }
  },
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
  now() {
    return Date.now();
  }
};

/**
 * Capture one ready preview URL and persist the bitmap on the surface record.
 * Never throws: a failed capture leaves the previous screenshot in place.
 * HTTP must succeed first, then `waitUntil: "load"` (never networkidle — a
 * Next dev server holds its HMR websocket open forever), `document.fonts.ready`,
 * two animation frames, and a short settle window.
 */
export async function capturePrototypeSurfaceScreenshot(
  projectPath: string,
  surfaceId: string,
  previewUrl: string,
  deps: PrototypeScreenshotDeps = defaultPrototypeScreenshotDeps,
  options: PrototypeScreenshotOptions = {}
): Promise<PrototypeScreenshotResult> {
  const viewportWidth = normalizePrototypeScreenshotViewportWidth(
    options.viewportWidth ?? PROTOTYPE_SCREENSHOT_DEFAULT_VIEWPORT_WIDTH
  );

  const preflight = await deps.fetchStatus(previewUrl);
  if (!preflight.ok) return { ok: false, reason: "preview_unreachable" };
  if (preflight.status >= 400) return { ok: false, reason: `http_${preflight.status}` };

  let browser: PrototypeScreenshotBrowser;
  try {
    browser = await deps.launchBrowser();
  } catch {
    return { ok: false, reason: "browser_unavailable" };
  }

  let bytes: Buffer;
  try {
    const page = await browser.newPage();
    await page.setViewportSize({
      width: viewportWidth,
      height: PROTOTYPE_SCREENSHOT_VIEWPORT_HEIGHT
    });
    await page.goto(previewUrl, {
      waitUntil: "load",
      timeout: SCREENSHOT_GOTO_TIMEOUT_MS
    });
    await page.evaluate(async () => {
      const fonts = (
        document as Document & { fonts?: { ready?: Promise<unknown> } }
      ).fonts;
      if (fonts?.ready) await fonts.ready;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
    });
    await deps.sleep(SCREENSHOT_RENDER_WAIT_MS);
    // Full-page so the canvas placeholder shows the whole document like the
    // live iframe (the body is far taller than the 900px viewport), not just
    // the above-the-fold crop.
    bytes = await page.screenshot({ type: "png", fullPage: true });
  } catch {
    return { ok: false, reason: "capture_failed" };
  } finally {
    try {
      await browser.close();
    } catch {
      // The browser is already gone — nothing to clean up.
    }
  }

  // One rebuildable placeholder per surface. Atomic overwrite prevents an
  // iteration trail of timestamped PNGs from accumulating indefinitely.
  const fileName = prototypeScreenshotFileName(surfaceId, viewportWidth);
  // Stored project-relative with forward slashes, matching evidence-media's
  // `.ikran/artifacts/evidence-media/...` convention, so the Workbench serves
  // it through /api/artifacts.
  const relativePath = path.posix.join(
    ".ikran",
    "artifacts",
    PROTOTYPE_MEDIA_DIR_NAME,
    fileName
  );
  try {
    deps.writeArtifact(
      path.join(getArtifactsDir(projectPath), PROTOTYPE_MEDIA_DIR_NAME, fileName),
      bytes
    );
  } catch {
    return { ok: false, reason: "write_failed" };
  }

  const persisted = deps.persist(
    projectPath,
    surfaceId,
    relativePath,
    options.expectedGeneration
  );
  if (!persisted.ok) return { ok: false, reason: persisted.reason };
  const managedRoot = path.resolve(
    getArtifactsDir(projectPath),
    PROTOTYPE_MEDIA_DIR_NAME
  );
  const surfacePrefix = `${encodeURIComponent(surfaceId)}-`;
  for (const candidate of deps.listArtifacts(managedRoot)) {
    if (
      candidate !== fileName &&
      candidate.startsWith(surfacePrefix) &&
      candidate.toLowerCase().endsWith(".png")
    ) {
      deps.removeArtifact(path.join(managedRoot, candidate));
    }
  }
  return { ok: true, artifact_path: relativePath };
}
