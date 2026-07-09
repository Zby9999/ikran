// Evidence package schema validation (Issue 05).
//
// Agent host declares Figma evidence via a structured package. Runtime validates
// schema ONLY — no Figma network, no DB, no MCP in this module.
//
// URL format rules mirror seed-reference.ts local checks (https + figma.com +
// /design|/file path). Original URL strings are kept verbatim when present.

export type EvidenceViewStatus = "available" | "missing";

export interface EvidencePackageFrameBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EvidencePackageFrame {
  nodeId: string;
  name: string;
  bounds?: EvidencePackageFrameBounds;
}

export interface EvidenceViews {
  rawData: EvidenceViewStatus;
  screenshot: EvidenceViewStatus;
}

export interface EvidenceScreenshot {
  artifactPath?: string;
  dataUrl?: string;
}

export interface DesignSignal {
  id: string;
  label: string;
  evidence: string;
}

export interface SurfaceBounds {
  width: number;
  height: number;
}

/** Input shape accepted by validateEvidencePackage (unknown fields ignored). */
export interface EvidencePackageInput {
  figmaSeedReference?: string;
  seedReferenceId?: string;
  frame: EvidencePackageFrame;
  evidenceViews: EvidenceViews;
  screenshot?: EvidenceScreenshot;
  designSignals?: DesignSignal[];
  surfaceBounds?: SurfaceBounds;
}

/** Normalized package returned on successful validation. */
export interface NormalizedEvidencePackage {
  figmaSeedReference?: string;
  seedReferenceId?: string;
  frame: EvidencePackageFrame;
  evidenceViews: EvidenceViews;
  screenshot?: EvidenceScreenshot;
  designSignals?: DesignSignal[];
  surfaceBounds?: SurfaceBounds;
}

export type EvidencePackageValidationReason =
  | "missing_seed_reference"
  | "missing_figma_seed_reference"
  | "invalid_figma_url"
  | "not_figma_host"
  | "not_figma_design_path"
  | "missing_frame"
  | "missing_frame_node_id"
  | "missing_frame_name"
  | "invalid_frame_bounds"
  | "missing_evidence_views"
  | "invalid_evidence_views"
  | "screenshot_required_when_available"
  | "screenshot_payload_when_missing"
  | "screenshot_too_large"
  | "invalid_screenshot"
  | "invalid_design_signals"
  | "design_signals_too_many"
  | "invalid_surface_bounds";

export type EvidencePackageOk = {
  ok: true;
  package: NormalizedEvidencePackage;
};

export type EvidencePackageError = {
  ok: false;
  reason: EvidencePackageValidationReason | string;
  details?: unknown;
};

export type EvidencePackageValidationResult =
  | EvidencePackageOk
  | EvidencePackageError;

const SCREENSHOT_DATA_URL_MAX_CHARS = 2_000_000;
const DESIGN_SIGNALS_MAX = 20;

/** Local Figma URL format check — same rules as seed-reference.ts. No network. */
export function validateFigmaSeedReferenceUrl(
  rawUrl: string
): "invalid_figma_url" | "not_figma_host" | "not_figma_design_path" | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return "invalid_figma_url";
  }
  if (url.protocol !== "https:") {
    return "invalid_figma_url";
  }
  if (url.hostname !== "figma.com" && url.hostname !== "www.figma.com") {
    return "not_figma_host";
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const hasDesignPath =
    parts.length >= 2 && (parts[0] === "design" || parts[0] === "file");
  if (!hasDesignPath) {
    return "not_figma_design_path";
  }
  return null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isEvidenceViewStatus(value: unknown): value is EvidenceViewStatus {
  return value === "available" || value === "missing";
}

function fail(
  reason: EvidencePackageValidationReason | string,
  details?: unknown
): EvidencePackageError {
  return details === undefined
    ? { ok: false, reason }
    : { ok: false, reason, details };
}

export function validateEvidencePackage(
  input: unknown
): EvidencePackageValidationResult {
  if (input === null || typeof input !== "object") {
    return fail("missing_frame", { message: "input must be an object" });
  }
  const raw = input as Record<string, unknown>;

  // --- seed reference: at least one of figmaSeedReference | seedReferenceId ---
  const figmaRaw = raw.figmaSeedReference;
  const seedIdRaw = raw.seedReferenceId;
  const hasFigma =
    typeof figmaRaw === "string" && figmaRaw.trim().length > 0;
  const hasSeedId =
    typeof seedIdRaw === "string" && seedIdRaw.trim().length > 0;

  if (!hasFigma && !hasSeedId) {
    return fail("missing_seed_reference");
  }

  let figmaSeedReference: string | undefined;
  if (hasFigma) {
    const urlError = validateFigmaSeedReferenceUrl(figmaRaw);
    if (urlError) {
      return fail(urlError);
    }
    // Keep original string verbatim (do not trim/rewrite for storage).
    figmaSeedReference = figmaRaw;
  }

  const seedReferenceId = hasSeedId ? seedIdRaw : undefined;

  // --- frame ---
  const frameRaw = raw.frame;
  if (frameRaw === null || typeof frameRaw !== "object") {
    return fail("missing_frame");
  }
  const frameObj = frameRaw as Record<string, unknown>;
  if (!isNonEmptyString(frameObj.nodeId)) {
    return fail("missing_frame_node_id");
  }
  if (!isNonEmptyString(frameObj.name)) {
    return fail("missing_frame_name");
  }

  const frame: EvidencePackageFrame = {
    nodeId: frameObj.nodeId,
    name: frameObj.name
  };

  if (frameObj.bounds !== undefined) {
    if (frameObj.bounds === null || typeof frameObj.bounds !== "object") {
      return fail("invalid_frame_bounds");
    }
    const b = frameObj.bounds as Record<string, unknown>;
    if (
      !isFiniteNumber(b.x) ||
      !isFiniteNumber(b.y) ||
      !isFiniteNumber(b.width) ||
      !isFiniteNumber(b.height)
    ) {
      return fail("invalid_frame_bounds");
    }
    frame.bounds = {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height
    };
  }

  // --- evidenceViews ---
  const viewsRaw = raw.evidenceViews;
  if (viewsRaw === null || typeof viewsRaw !== "object") {
    return fail("missing_evidence_views");
  }
  const viewsObj = viewsRaw as Record<string, unknown>;
  if (
    !isEvidenceViewStatus(viewsObj.rawData) ||
    !isEvidenceViewStatus(viewsObj.screenshot)
  ) {
    return fail("invalid_evidence_views");
  }
  const evidenceViews: EvidenceViews = {
    rawData: viewsObj.rawData,
    screenshot: viewsObj.screenshot
  };

  // --- screenshot ---
  let screenshot: EvidenceScreenshot | undefined;
  const shotRaw = raw.screenshot;

  if (evidenceViews.screenshot === "available") {
    if (shotRaw === null || typeof shotRaw !== "object") {
      return fail("screenshot_required_when_available");
    }
    const shot = shotRaw as Record<string, unknown>;
    const artifactPath =
      typeof shot.artifactPath === "string" ? shot.artifactPath : undefined;
    const dataUrl =
      typeof shot.dataUrl === "string" ? shot.dataUrl : undefined;
    const hasArtifact =
      typeof artifactPath === "string" && artifactPath.trim().length > 0;
    const hasDataUrl =
      typeof dataUrl === "string" && dataUrl.trim().length > 0;

    if (!hasArtifact && !hasDataUrl) {
      return fail("screenshot_required_when_available");
    }
    if (hasDataUrl && dataUrl!.length > SCREENSHOT_DATA_URL_MAX_CHARS) {
      return fail("screenshot_too_large", {
        maxChars: SCREENSHOT_DATA_URL_MAX_CHARS,
        length: dataUrl!.length
      });
    }

    screenshot = {};
    if (hasArtifact) screenshot.artifactPath = artifactPath;
    if (hasDataUrl) screenshot.dataUrl = dataUrl;
  } else {
    // screenshot === "missing"
    if (shotRaw !== undefined && shotRaw !== null) {
      if (typeof shotRaw !== "object") {
        return fail("screenshot_payload_when_missing");
      }
      const shot = shotRaw as Record<string, unknown>;
      const hasArtifact =
        typeof shot.artifactPath === "string" &&
        shot.artifactPath.trim().length > 0;
      const hasDataUrl =
        typeof shot.dataUrl === "string" && shot.dataUrl.trim().length > 0;
      if (hasArtifact || hasDataUrl) {
        return fail("screenshot_payload_when_missing");
      }
      // Empty object / empty strings — treat as no payload; still reject for
      // strictness if any screenshot key was supplied with content above.
      // Bare `{}` or undefined fields: reject if object present with any keys?
      // Prefer: only reject when non-empty payload fields exist (already done).
      // If object is present but empty, ignore (no payload).
    }
  }

  // --- designSignals (optional) ---
  let designSignals: DesignSignal[] | undefined;
  if (raw.designSignals !== undefined) {
    if (!Array.isArray(raw.designSignals)) {
      return fail("invalid_design_signals");
    }
    if (raw.designSignals.length > DESIGN_SIGNALS_MAX) {
      return fail("design_signals_too_many", { max: DESIGN_SIGNALS_MAX });
    }
    designSignals = [];
    for (let i = 0; i < raw.designSignals.length; i++) {
      const item = raw.designSignals[i];
      if (item === null || typeof item !== "object") {
        return fail("invalid_design_signals", { index: i });
      }
      const s = item as Record<string, unknown>;
      if (
        !isNonEmptyString(s.id) ||
        !isNonEmptyString(s.label) ||
        !isNonEmptyString(s.evidence)
      ) {
        return fail("invalid_design_signals", { index: i });
      }
      designSignals.push({
        id: s.id,
        label: s.label,
        evidence: s.evidence
      });
    }
  }

  // --- surfaceBounds (optional) ---
  let surfaceBounds: SurfaceBounds | undefined;
  if (raw.surfaceBounds !== undefined) {
    if (raw.surfaceBounds === null || typeof raw.surfaceBounds !== "object") {
      return fail("invalid_surface_bounds");
    }
    const sb = raw.surfaceBounds as Record<string, unknown>;
    if (
      !isFiniteNumber(sb.width) ||
      !isFiniteNumber(sb.height) ||
      sb.width <= 0 ||
      sb.height <= 0
    ) {
      return fail("invalid_surface_bounds");
    }
    surfaceBounds = { width: sb.width, height: sb.height };
  }

  const normalized: NormalizedEvidencePackage = {
    frame,
    evidenceViews
  };
  if (figmaSeedReference !== undefined) {
    normalized.figmaSeedReference = figmaSeedReference;
  }
  if (seedReferenceId !== undefined) {
    normalized.seedReferenceId = seedReferenceId;
  }
  if (screenshot !== undefined) {
    normalized.screenshot = screenshot;
  }
  if (designSignals !== undefined) {
    normalized.designSignals = designSignals;
  }
  if (surfaceBounds !== undefined) {
    normalized.surfaceBounds = surfaceBounds;
  }

  return { ok: true, package: normalized };
}
