// Client-safe Workbench layout types + pure helpers (no Node / SQLite).
// Server I/O lives in `workbench-layout.ts`.

export const WORKBENCH_LAYOUT_VERSION = 1 as const;

export type WorkbenchCameraLayout = {
  x: number;
  y: number;
  z: number;
};

export type WorkbenchFrameLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
  layoutLocked: boolean;
};

export type WorkbenchLayoutDocument = {
  version: typeof WORKBENCH_LAYOUT_VERSION;
  camera: WorkbenchCameraLayout;
  frames: Record<string, WorkbenchFrameLayout>;
};

export type WorkbenchLayoutErrorReason =
  | "invalid_layout"
  | "write_failed"
  | "read_failed";

const DEFAULT_CAMERA: WorkbenchCameraLayout = { x: 0, y: 0, z: 1 };

export function emptyWorkbenchLayout(): WorkbenchLayoutDocument {
  return {
    version: WORKBENCH_LAYOUT_VERSION,
    camera: { ...DEFAULT_CAMERA },
    frames: {}
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseCamera(raw: unknown): WorkbenchCameraLayout | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isFiniteNumber(o.x) || !isFiniteNumber(o.y) || !isFiniteNumber(o.z)) {
    return null;
  }
  // Reject non-positive zoom — tldraw camera.z must stay usable.
  if (o.z <= 0) return null;
  return { x: o.x, y: o.y, z: o.z };
}

function parseFrame(raw: unknown): WorkbenchFrameLayout | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    !isFiniteNumber(o.x) ||
    !isFiniteNumber(o.y) ||
    !isFiniteNumber(o.w) ||
    !isFiniteNumber(o.h)
  ) {
    return null;
  }
  if (o.w <= 0 || o.h <= 0) return null;
  return {
    x: o.x,
    y: o.y,
    w: o.w,
    h: o.h,
    layoutLocked: o.layoutLocked === true
  };
}

/**
 * Parse and normalize a layout document. Unknown keys in frames are dropped
 * when `keepFrameIds` is provided; invalid frame entries are skipped.
 */
export function parseWorkbenchLayout(
  raw: unknown,
  keepFrameIds?: ReadonlySet<string>
): WorkbenchLayoutDocument | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== WORKBENCH_LAYOUT_VERSION) return null;

  const camera = parseCamera(o.camera) ?? { ...DEFAULT_CAMERA };
  const framesIn =
    o.frames !== null && typeof o.frames === "object" && !Array.isArray(o.frames)
      ? (o.frames as Record<string, unknown>)
      : {};

  const frames: Record<string, WorkbenchFrameLayout> = {};
  for (const [id, entry] of Object.entries(framesIn)) {
    if (typeof id !== "string" || id.trim().length === 0) continue;
    if (keepFrameIds && !keepFrameIds.has(id)) continue;
    const frame = parseFrame(entry);
    if (!frame) continue;
    frames[id] = frame;
  }

  return {
    version: WORKBENCH_LAYOUT_VERSION,
    camera,
    frames
  };
}

export function reconcileWorkbenchLayout(
  layout: WorkbenchLayoutDocument,
  keepFrameIds: ReadonlySet<string>
): WorkbenchLayoutDocument {
  const frames: Record<string, WorkbenchFrameLayout> = {};
  for (const [id, frame] of Object.entries(layout.frames)) {
    if (keepFrameIds.has(id)) frames[id] = frame;
  }
  return {
    version: WORKBENCH_LAYOUT_VERSION,
    camera: { ...layout.camera },
    frames
  };
}
