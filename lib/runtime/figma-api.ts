// Deterministic Figma REST client for positional evidence (ADR 0003 / Issue 05A).
// Injectable via `setFigmaApiClientForTests` or `IKRAN_FIGMA_API_BASE` for doubles.

export type FigmaAccountIdentity = {
  /** Non-sensitive account handle / email for UI status. Never a token. */
  handle: string;
  email?: string;
};

export type FigmaPositionalNode = {
  id: string;
  parentId: string | null;
  name: string;
  type: string;
  depth: number;
  visible: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
};

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
    | { ok: false; reason: "invalid_token" | "figma_api_error" }
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
          | "figma_api_error";
      }
  >;
};

const DEFAULT_BASE = "https://api.figma.com";

type FetchLike = typeof fetch;

function resolveBaseUrl(): string {
  const fromEnv = process.env.IKRAN_FIGMA_API_BASE?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return DEFAULT_BASE;
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json"
  };
}

type AbsoluteBounds = { x: number; y: number; width: number; height: number };

type RawNode = {
  id?: string;
  name?: string;
  type?: string;
  visible?: boolean;
  absoluteBoundingBox?: AbsoluteBounds;
  children?: RawNode[];
};

function walkNodes(
  node: RawNode,
  parentId: string | null,
  depth: number,
  out: FigmaPositionalNode[]
): void {
  if (typeof node.id !== "string" || typeof node.name !== "string") return;
  const type = typeof node.type === "string" ? node.type : "UNKNOWN";
  const visible = node.visible !== false;
  const box = node.absoluteBoundingBox;
  out.push({
    id: node.id,
    parentId,
    name: node.name,
    type,
    depth,
    visible,
    bounds:
      box &&
      typeof box.x === "number" &&
      typeof box.y === "number" &&
      typeof box.width === "number" &&
      typeof box.height === "number"
        ? {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height
          }
        : null
  });
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walkNodes(child, node.id, depth + 1, out);
    }
  }
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
  options?: { fetchImpl?: FetchLike; baseUrl?: string }
): FigmaApiClient {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const baseUrl = options?.baseUrl ?? resolveBaseUrl();

  return {
    async validateToken(token) {
      try {
        const res = await fetchImpl(`${baseUrl}/v1/me`, {
          method: "GET",
          headers: authHeaders(token)
        });
        if (!res.ok) {
          return {
            ok: false,
            reason: mapStatusReason(res.status) === "invalid_token" ||
              res.status === 403
              ? "invalid_token"
              : "figma_api_error"
          };
        }
        const body = (await res.json()) as {
          handle?: string;
          email?: string;
        };
        const handle =
          typeof body.handle === "string" && body.handle.trim()
            ? body.handle.trim()
            : typeof body.email === "string" && body.email.trim()
              ? body.email.trim()
              : null;
        if (!handle) {
          return { ok: false, reason: "figma_api_error" };
        }
        return {
          ok: true,
          account: {
            handle,
            ...(typeof body.email === "string" ? { email: body.email } : {})
          }
        };
      } catch {
        return { ok: false, reason: "figma_api_error" };
      }
    },

    async capturePositionalEvidence({ token, fileKey, nodeId }) {
      try {
        const nodesUrl = `${baseUrl}/v1/files/${encodeURIComponent(
          fileKey
        )}/nodes?ids=${encodeURIComponent(nodeId)}`;
        const nodesRes = await fetchImpl(nodesUrl, {
          method: "GET",
          headers: authHeaders(token)
        });
        if (!nodesRes.ok) {
          return { ok: false, reason: mapStatusReason(nodesRes.status) };
        }
        const nodesBody = (await nodesRes.json()) as {
          nodes?: Record<string, { document?: RawNode } | null>;
        };
        const entry = nodesBody.nodes?.[nodeId];
        const document = entry?.document;
        if (!document || typeof document !== "object") {
          return { ok: false, reason: "malformed_figma_response" };
        }

        const positional: FigmaPositionalNode[] = [];
        walkNodes(document, null, 0, positional);
        const root = positional[0];
        if (!root) {
          return { ok: false, reason: "malformed_figma_response" };
        }

        const imagesUrl = `${baseUrl}/v1/images/${encodeURIComponent(
          fileKey
        )}?ids=${encodeURIComponent(nodeId)}&format=png&scale=2`;
        const imagesRes = await fetchImpl(imagesUrl, {
          method: "GET",
          headers: authHeaders(token)
        });
        if (!imagesRes.ok) {
          return { ok: false, reason: mapStatusReason(imagesRes.status) };
        }
        const imagesBody = (await imagesRes.json()) as {
          images?: Record<string, string | null>;
        };
        const imageUrl = imagesBody.images?.[nodeId];
        if (!imageUrl || typeof imageUrl !== "string") {
          return { ok: false, reason: "screenshot_missing" };
        }

        const imgRes = await fetchImpl(imageUrl, { method: "GET" });
        if (!imgRes.ok) {
          return { ok: false, reason: "screenshot_missing" };
        }
        const buf = Buffer.from(await imgRes.arrayBuffer());
        if (buf.byteLength === 0) {
          return { ok: false, reason: "screenshot_missing" };
        }
        const contentType = imgRes.headers.get("content-type") || "image/png";
        const mime = contentType.split(";")[0]?.trim() || "image/png";
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
            surfaceBounds: bounds
              ? { width: bounds.width, height: bounds.height }
              : { width: 0, height: 0 }
          }
        };
      } catch {
        return { ok: false, reason: "figma_api_error" };
      }
    }
  };
}

/** Deterministic double for e2e / harness — never hits the real Figma network. */
export function createMockFigmaApiClient(): FigmaApiClient {
  const TINY_PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
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
          screenshotDataUrl: TINY_PNG,
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
            }
          ],
          surfaceBounds: { width: 320, height: 240 }
        }
      };
    }
  };
}

let override: FigmaApiClient | null = null;
let cached: FigmaApiClient | null = null;

export function setFigmaApiClientForTests(client: FigmaApiClient | null): void {
  override = client;
  cached = null;
}

export function resetFigmaApiClientForTests(): void {
  override = null;
  cached = null;
}

export function getFigmaApiClient(): FigmaApiClient {
  if (override) return override;
  if (cached) return cached;
  if (process.env.IKRAN_FIGMA_API_MODE === "mock") {
    cached = createMockFigmaApiClient();
    return cached;
  }
  cached = createFigmaApiClient();
  return cached;
}
