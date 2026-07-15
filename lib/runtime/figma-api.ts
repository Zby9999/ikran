// Deterministic Figma REST client for positional evidence (ADR 0003 / Issue 05A).
// Injectable via `setFigmaApiClientForTests` or `IKRAN_FIGMA_API_BASE` for doubles.

import {
  isDefaultSelectableFigmaNode,
  type PositionalEvidenceNode
} from "./figma-positional-evidence";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

export type FigmaAccountIdentity = {
  /** Non-sensitive account handle / email for UI status. Never a token. */
  handle: string;
  email?: string;
};

export type FigmaPositionalNode = PositionalEvidenceNode;

export type FigmaPositionalCapture = {
  screenshotDataUrl: string;
  frame: {
    nodeId: string;
    name: string;
    bounds: { x: number; y: number; width: number; height: number } | null;
  };
  nodes: FigmaPositionalNode[];
  surfaceBounds: { width: number; height: number };
};

export type FigmaApiClient = {
  validateToken(token: string): Promise<
    | { ok: true; account: FigmaAccountIdentity }
    | {
        ok: false;
        reason: "invalid_token" | "figma_api_timeout" | "figma_api_error";
      }
  >;
  capturePositionalEvidence(input: {
    token: string;
    fileKey: string;
    nodeId: string;
  }): Promise<
    | { ok: true; capture: FigmaPositionalCapture }
    | {
        ok: false;
        reason:
          | "invalid_token"
          | "forbidden"
          | "not_found"
          | "rate_limited"
          | "screenshot_missing"
          | "malformed_figma_response"
          | "figma_api_timeout"
          | "figma_api_error";
      }
  >;
};

const DEFAULT_BASE = "https://api.figma.com";

type FetchLike = typeof fetch;

/**
 * Node's global fetch does not consistently honor HTTP_PROXY / HTTPS_PROXY
 * unless the process is started with a version-specific CLI flag. Figma's
 * render endpoint returns a signed S3 URL, so a machine that requires its
 * standard outbound proxy can reach api.figma.com but stall forever while
 * reading the screenshot body. Keep proxy handling local to the Figma client
 * and preserve NO_PROXY semantics through Undici's environment agent.
 */
function createRuntimeFigmaFetch(): FetchLike {
  const httpProxy = process.env.http_proxy ?? process.env.HTTP_PROXY;
  const httpsProxy = process.env.https_proxy ?? process.env.HTTPS_PROXY;
  if (!httpProxy && !httpsProxy) return fetch;

  const dispatcher = new EnvHttpProxyAgent({
    httpProxy,
    httpsProxy,
    noProxy: process.env.no_proxy ?? process.env.NO_PROXY
  });
  return ((input, init) =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher
    }) as unknown as Promise<Response>) as FetchLike;
}

const DEFAULT_API_TIMEOUT_MS = 10_000;
const DEFAULT_SCREENSHOT_TIMEOUT_MS = 30_000;

class FigmaApiTimeoutError extends Error {
  constructor() {
    super("Figma request timed out");
    this.name = "FigmaApiTimeoutError";
  }
}

async function withRequestTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new FigmaApiTimeoutError());
    }, timeoutMs);
  });
  try {
    // The race guarantees a deadline even for injected fetch implementations
    // that ignore AbortSignal. Production fetch still receives the abort so
    // sockets and response streams are released promptly.
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isFigmaApiTimeout(error: unknown): boolean {
  return error instanceof FigmaApiTimeoutError;
}

function resolveBaseUrl(): string {
  const fromEnv = process.env.IKRAN_FIGMA_API_BASE?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return DEFAULT_BASE;
}

function authHeaders(token: string): HeadersInit {
  // Personal access tokens must use X-Figma-Token (not Authorization Bearer).
  // https://developers.figma.com/docs/rest-api/personal-access-tokens/
  return {
    "X-Figma-Token": token,
    Accept: "application/json"
  };
}

type AbsoluteBounds = { x: number; y: number; width: number; height: number };

type RawNode = {
  id?: string;
  name?: string;
  type?: string;
  visible?: boolean;
  clipsContent?: boolean;
  absoluteBoundingBox?: AbsoluteBounds;
  absoluteRenderBounds?: AbsoluteBounds;
  fills?: Array<{ type?: string; visible?: boolean }>;
  children?: RawNode[];
};

function parseAbsoluteBounds(box: unknown): AbsoluteBounds | null {
  if (!box || typeof box !== "object") return null;
  const b = box as AbsoluteBounds;
  if (
    typeof b.x !== "number" ||
    typeof b.y !== "number" ||
    typeof b.width !== "number" ||
    typeof b.height !== "number"
  ) {
    return null;
  }
  if (!(b.width > 0) || !(b.height > 0)) return null;
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

function intersectAbsoluteBounds(
  a: AbsoluteBounds,
  b: AbsoluteBounds
): AbsoluteBounds | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * Minimum positional index for structural overlay: every indexed node needs
 * id/name/type; the capture root also needs positive absolute bounds.
 * Incomplete children fail closed — never skip or invent UNKNOWN.
 */
function walkNodes(
  node: RawNode,
  parentId: string | null,
  depth: number,
  out: FigmaPositionalNode[],
  inheritedVisible = true,
  ancestorClip: AbsoluteBounds | null | undefined = undefined
): boolean {
  if (typeof node.id !== "string" || !node.id.trim()) return false;
  if (typeof node.name !== "string") return false;
  if (typeof node.type !== "string" || !node.type.trim()) return false;

  const bounds = parseAbsoluteBounds(node.absoluteBoundingBox);
  if (depth === 0 && !bounds) return false;

  const visible = inheritedVisible && node.visible !== false;
  const rawRenderBounds = parseAbsoluteBounds(node.absoluteRenderBounds) ?? bounds;
  const clipRenderBounds =
    ancestorClip === null || rawRenderBounds === null
      ? null
      : ancestorClip === undefined
        ? rawRenderBounds
        : intersectAbsoluteBounds(rawRenderBounds, ancestorClip);
  const positionalNode: FigmaPositionalNode = {
    id: node.id,
    parentId,
    name: node.name,
    type: node.type,
    depth,
    visible,
    bounds,
    clipRenderBounds
  };
  const hasVisibleImageFill =
    Array.isArray(node.fills) &&
    node.fills.some(
      (fill) => fill?.type === "IMAGE" && fill.visible !== false
    );
  positionalNode.selectable =
    visible &&
    clipRenderBounds !== null &&
    (hasVisibleImageFill || isDefaultSelectableFigmaNode(positionalNode));
  out.push(positionalNode);

  if (node.children === undefined) return true;
  if (!Array.isArray(node.children)) return false;
  let childClip = ancestorClip;
  if (node.clipsContent === true && bounds) {
    childClip =
      ancestorClip === null
        ? null
        : ancestorClip === undefined
          ? bounds
          : intersectAbsoluteBounds(ancestorClip, bounds);
  }
  for (const child of node.children) {
    if (!child || typeof child !== "object") return false;
    if (!walkNodes(child, node.id, depth + 1, out, visible, childClip)) {
      return false;
    }
  }
  return true;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);

function isPngBuffer(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

function isJpegBuffer(buf: Buffer): boolean {
  return (
    buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  );
}

/** Fail closed unless MIME is image/* and bytes match a decodable image magic. */
function resolveScreenshotMime(
  contentTypeHeader: string | null,
  buf: Buffer
): string | null {
  if (buf.byteLength === 0) return null;
  const raw = contentTypeHeader?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (raw && !raw.startsWith("image/")) return null;

  if (isPngBuffer(buf)) {
    if (!raw || raw === "image/png" || raw === "image/x-png") return "image/png";
    return null;
  }
  if (isJpegBuffer(buf)) {
    if (!raw || raw === "image/jpeg" || raw === "image/jpg") return "image/jpeg";
    return null;
  }
  return null;
}

function mapStatusReason(
  status: number
):
  | "invalid_token"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "figma_api_error" {
  if (status === 401 || status === 403) {
    return status === 401 ? "invalid_token" : "forbidden";
  }
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "figma_api_error";
}

export function createFigmaApiClient(
  options?: {
    fetchImpl?: FetchLike;
    baseUrl?: string;
    apiTimeoutMs?: number;
    screenshotTimeoutMs?: number;
  }
): FigmaApiClient {
  const fetchImpl = options?.fetchImpl ?? createRuntimeFigmaFetch();
  const baseUrl = options?.baseUrl ?? resolveBaseUrl();
  const apiTimeoutMs = options?.apiTimeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  const screenshotTimeoutMs =
    options?.screenshotTimeoutMs ?? DEFAULT_SCREENSHOT_TIMEOUT_MS;

  return {
    async validateToken(token) {
      try {
        const { res, body } = await withRequestTimeout(
          apiTimeoutMs,
          async (signal) => {
            const res = await fetchImpl(`${baseUrl}/v1/me`, {
              method: "GET",
              headers: authHeaders(token),
              signal
            });
            const body = res.ok
              ? ((await res.json()) as { handle?: string; email?: string })
              : null;
            return { res, body };
          }
        );
        if (!res.ok) {
          return {
            ok: false,
            reason: mapStatusReason(res.status) === "invalid_token" ||
              res.status === 403
              ? "invalid_token"
              : "figma_api_error"
          };
        }
        const handle =
          typeof body?.handle === "string" && body.handle.trim()
            ? body.handle.trim()
            : typeof body?.email === "string" && body.email.trim()
              ? body.email.trim()
              : null;
        if (!handle) {
          return { ok: false, reason: "figma_api_error" };
        }
        return {
          ok: true,
          account: {
            handle,
            ...(typeof body?.email === "string" ? { email: body.email } : {})
          }
        };
      } catch (error) {
        if (isFigmaApiTimeout(error)) {
          return { ok: false, reason: "figma_api_timeout" };
        }
        return { ok: false, reason: "figma_api_error" };
      }
    },

    async capturePositionalEvidence({ token, fileKey, nodeId }) {
      try {
        const nodesUrl = `${baseUrl}/v1/files/${encodeURIComponent(
          fileKey
        )}/nodes?ids=${encodeURIComponent(nodeId)}`;
        const { res: nodesRes, body: nodesBody } = await withRequestTimeout(
          apiTimeoutMs,
          async (signal) => {
            const res = await fetchImpl(nodesUrl, {
              method: "GET",
              headers: authHeaders(token),
              signal
            });
            const body = res.ok
              ? ((await res.json()) as {
                  nodes?: Record<string, { document?: RawNode } | null>;
                })
              : null;
            return { res, body };
          }
        );
        if (!nodesRes.ok) {
          return { ok: false, reason: mapStatusReason(nodesRes.status) };
        }
        const entry = nodesBody?.nodes?.[nodeId];
        const document = entry?.document;
        if (!document || typeof document !== "object") {
          return { ok: false, reason: "malformed_figma_response" };
        }

        const positional: FigmaPositionalNode[] = [];
        if (!walkNodes(document, null, 0, positional)) {
          return { ok: false, reason: "malformed_figma_response" };
        }
        const root = positional[0];
        if (!root || !root.bounds) {
          return { ok: false, reason: "malformed_figma_response" };
        }

        const imagesUrl = `${baseUrl}/v1/images/${encodeURIComponent(
          fileKey
        )}?ids=${encodeURIComponent(nodeId)}&format=png&scale=2`;
        const { res: imagesRes, body: imagesBody } = await withRequestTimeout(
          apiTimeoutMs,
          async (signal) => {
            const res = await fetchImpl(imagesUrl, {
              method: "GET",
              headers: authHeaders(token),
              signal
            });
            const body = res.ok
              ? ((await res.json()) as {
                  images?: Record<string, string | null>;
                })
              : null;
            return { res, body };
          }
        );
        if (!imagesRes.ok) {
          return { ok: false, reason: mapStatusReason(imagesRes.status) };
        }
        const imageUrl = imagesBody?.images?.[nodeId];
        if (!imageUrl || typeof imageUrl !== "string") {
          return { ok: false, reason: "screenshot_missing" };
        }

        const { res: imgRes, buf } = await withRequestTimeout(
          screenshotTimeoutMs,
          async (signal) => {
            const res = await fetchImpl(imageUrl, { method: "GET", signal });
            const buf = res.ok
              ? Buffer.from(await res.arrayBuffer())
              : Buffer.alloc(0);
            return { res, buf };
          }
        );
        if (!imgRes.ok) {
          return { ok: false, reason: "screenshot_missing" };
        }
        const mime = resolveScreenshotMime(
          imgRes.headers.get("content-type"),
          buf
        );
        if (!mime) {
          return { ok: false, reason: "screenshot_missing" };
        }
        const screenshotDataUrl = `data:${mime};base64,${buf.toString("base64")}`;

        const bounds = root.bounds;
        return {
          ok: true,
          capture: {
            screenshotDataUrl,
            frame: {
              nodeId: root.id,
              name: root.name,
              bounds
            },
            nodes: positional,
            surfaceBounds: { width: bounds.width, height: bounds.height }
          }
        };
      } catch (error) {
        if (isFigmaApiTimeout(error)) {
          return { ok: false, reason: "figma_api_timeout" };
        }
        return { ok: false, reason: "figma_api_error" };
      }
    }
  };
}

/** Deterministic double for e2e / harness — never hits the real Figma network. */
export function createMockFigmaApiClient(): FigmaApiClient {
  // 320×240 solid PNG so Workbench onLoad resize stays large enough for
  // region-annotation gesture e2e (media bounding box > 100px).
  const MOCK_FRAME_PNG =
    "data:image/png;base64,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";
  return {
    async validateToken(token) {
      if (token.startsWith("figd_ok")) {
        return { ok: true, account: { handle: "mock-designer" } };
      }
      return { ok: false, reason: "invalid_token" };
    },
    async capturePositionalEvidence({ nodeId, fileKey }) {
      if (nodeId === "0:0" || fileKey === "missing") {
        return { ok: false, reason: "not_found" };
      }
      return {
        ok: true,
        capture: {
          screenshotDataUrl: MOCK_FRAME_PNG,
          frame: {
            nodeId,
            name: "Mock Frame",
            bounds: { x: 0, y: 0, width: 320, height: 240 }
          },
          nodes: [
            {
              id: nodeId,
              parentId: null,
              name: "Mock Frame",
              type: "FRAME",
              depth: 0,
              visible: true,
              bounds: { x: 0, y: 0, width: 320, height: 240 }
            },
            ...(nodeId === "7:8"
              ? [
                  {
                    id: `${nodeId}:child-frame`,
                    parentId: nodeId,
                    name: "Mock child frame",
                    type: "FRAME",
                    depth: 1,
                    visible: true,
                    selectable: true,
                    bounds: { x: 32, y: 24, width: 160, height: 96 },
                    clipRenderBounds: {
                      x: 32,
                      y: 24,
                      width: 160,
                      height: 96
                    }
                  }
                ]
              : []),
            ...(nodeId === "7:9"
              ? [
                  {
                    id: `${nodeId}:child-frame`,
                    parentId: nodeId,
                    name: "Mock child frame",
                    type: "FRAME",
                    depth: 1,
                    visible: true,
                    selectable: true,
                    bounds: { x: 32, y: 24, width: 160, height: 96 }
                  },
                  {
                    id: `${nodeId}:child-text`,
                    parentId: `${nodeId}:child-frame`,
                    name: "Mock child text",
                    type: "TEXT",
                    depth: 2,
                    visible: true,
                    selectable: true,
                    bounds: { x: 64, y: 48, width: 64, height: 24 }
                  }
                ]
              : [])
          ],
          surfaceBounds: { width: 320, height: 240 }
        }
      };
    }
  };
}

let override: FigmaApiClient | null = null;
let liveCached: FigmaApiClient | null = null;

const GLOBAL = globalThis as unknown as {
  __IKRAN_FIGMA_API_MOCK?: FigmaApiClient;
};

export function setFigmaApiClientForTests(client: FigmaApiClient | null): void {
  override = client;
  liveCached = null;
  delete GLOBAL.__IKRAN_FIGMA_API_MOCK;
}

export function resetFigmaApiClientForTests(): void {
  override = null;
  liveCached = null;
  delete GLOBAL.__IKRAN_FIGMA_API_MOCK;
}

export function getFigmaApiClient(): FigmaApiClient {
  if (override) return override;
  if (process.env.IKRAN_FIGMA_API_MODE === "mock") {
    // Share mock across Next/MCP module forks (same as credential store).
    if (!GLOBAL.__IKRAN_FIGMA_API_MOCK) {
      GLOBAL.__IKRAN_FIGMA_API_MOCK = createMockFigmaApiClient();
    }
    return GLOBAL.__IKRAN_FIGMA_API_MOCK;
  }
  if (liveCached) return liveCached;
  liveCached = createFigmaApiClient();
  return liveCached;
}
