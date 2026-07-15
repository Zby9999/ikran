import { afterEach, beforeEach, expect, test } from "vitest";
import { createServer } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import {
  createFigmaApiClient,
  resetFigmaApiClientForTests
} from "../../lib/runtime/figma-api";

beforeEach(() => {
  resetFigmaApiClientForTests();
});

afterEach(() => {
  resetFigmaApiClientForTests();
});

test("validateToken sends X-Figma-Token (PAT auth), not Bearer-only", async () => {
  let seenAuth: HeadersInit | undefined;
  const client = createFigmaApiClient({
    baseUrl: "https://api.figma.test",
    fetchImpl: async (_input, init) => {
      seenAuth = init?.headers;
      return new Response(JSON.stringify({ handle: "ada" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  await client.validateToken("figd_real_pat");
  const headers = new Headers(seenAuth);
  expect(headers.get("X-Figma-Token")).toBe("figd_real_pat");
  expect(headers.get("Authorization")).toBeNull();
});

test("validateToken succeeds on /v1/me 200", async () => {
  const client = createFigmaApiClient({
    baseUrl: "https://api.figma.test",
    fetchImpl: async (input, init) => {
      expect(String(input)).toBe("https://api.figma.test/v1/me");
      expect(new Headers(init?.headers).get("X-Figma-Token")).toBe("figd_x");
      return new Response(JSON.stringify({ handle: "ada", email: "a@x.com" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  expect(await client.validateToken("figd_x")).toEqual({
    ok: true,
    account: { handle: "ada", email: "a@x.com" }
  });
});

test("validateToken maps 401 to invalid_token", async () => {
  const client = createFigmaApiClient({
    baseUrl: "https://api.figma.test",
    fetchImpl: async () => new Response("nope", { status: 401 })
  });
  expect(await client.validateToken("bad")).toEqual({
    ok: false,
    reason: "invalid_token"
  });
});

test("validateToken aborts and reports a structured timeout", async () => {
  let signal: AbortSignal | null = null;
  const client = createFigmaApiClient({
    baseUrl: "https://api.figma.test",
    apiTimeoutMs: 5,
    fetchImpl: async (_input, init) => {
      signal = init?.signal ?? null;
      return new Promise<Response>(() => undefined);
    }
  });

  expect(await client.validateToken("figd_x")).toEqual({
    ok: false,
    reason: "figma_api_timeout"
  });
  expect(signal).not.toBeNull();
  expect((signal as AbortSignal | null)?.aborted).toBe(true);
});

/** Minimal valid 1×1 PNG (real decoder signature). */
const TINY_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  )
);

const VALID_DOCUMENT = {
  id: "1:2",
  name: "Frame",
  type: "FRAME",
  absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 },
  absoluteRenderBounds: { x: 0, y: 0, width: 100, height: 50 },
  children: [
    {
      id: "1:3",
      name: "Title",
      type: "TEXT",
      absoluteBoundingBox: { x: 10, y: 10, width: 40, height: 12 },
      absoluteRenderBounds: { x: 9, y: 9, width: 42, height: 14 }
    }
  ]
};

function clientWithFixture(opts: {
  document?: unknown;
  imageBody?: Uint8Array;
  imageContentType?: string;
  imageStatus?: number;
}) {
  const document = opts.document ?? VALID_DOCUMENT;
  const imageBody = opts.imageBody ?? TINY_PNG;
  const imageContentType = opts.imageContentType ?? "image/png";
  const imageStatus = opts.imageStatus ?? 200;
  return createFigmaApiClient({
    baseUrl: "https://api.figma.test",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/nodes?")) {
        return new Response(
          JSON.stringify({ nodes: { "1:2": { document } } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/images/")) {
        return new Response(
          JSON.stringify({ images: { "1:2": "https://cdn.test/shot.png" } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url === "https://cdn.test/shot.png") {
        return new Response(new Blob([imageBody as BlobPart]), {
          status: imageStatus,
          headers: { "content-type": imageContentType }
        });
      }
      return new Response("miss", { status: 404 });
    }
  });
}

test("capturePositionalEvidence builds screenshot data URL and node index", async () => {
  const client = clientWithFixture({});
  const result = await client.capturePositionalEvidence({
    token: "figd_x",
    fileKey: "AbCd",
    nodeId: "1:2"
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.capture.screenshotDataUrl).toMatch(/^data:image\/png;base64,/);
  expect(result.capture.nodes).toHaveLength(2);
  expect(result.capture.nodes[1]).toMatchObject({
    id: "1:3",
    parentId: "1:2",
    name: "Title",
    type: "TEXT",
    depth: 1,
    visible: true,
    selectable: true,
    bounds: { x: 10, y: 10, width: 40, height: 12 },
    clipRenderBounds: { x: 9, y: 9, width: 42, height: 14 }
  });
  expect(Object.keys(result.capture.nodes[1]).sort()).toEqual([
    "bounds",
    "clipRenderBounds",
    "depth",
    "id",
    "name",
    "parentId",
    "selectable",
    "type",
    "visible"
  ]);
  expect(result.capture.frame.name).toBe("Frame");
});

test("positional index derives image selectability, effective visibility, and ancestor-clipped render bounds", async () => {
  const client = clientWithFixture({
    document: {
      id: "1:2",
      name: "Root",
      type: "FRAME",
      clipsContent: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 80 },
      absoluteRenderBounds: { x: 0, y: 0, width: 100, height: 80 },
      children: [
        {
          id: "1:3",
          name: "Hero photo",
          type: "RECTANGLE",
          fills: [{ type: "IMAGE", visible: true }],
          absoluteBoundingBox: { x: 90, y: 10, width: 30, height: 30 },
          absoluteRenderBounds: { x: 88, y: 8, width: 35, height: 35 }
        },
        {
          id: "1:4",
          name: "Hidden section",
          type: "FRAME",
          visible: false,
          absoluteBoundingBox: { x: 10, y: 10, width: 50, height: 40 },
          children: [
            {
              id: "1:5",
              name: "Invisible by ancestry",
              type: "TEXT",
              absoluteBoundingBox: { x: 20, y: 20, width: 20, height: 10 }
            }
          ]
        }
      ]
    }
  });
  const result = await client.capturePositionalEvidence({
    token: "t",
    fileKey: "f",
    nodeId: "1:2"
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  expect(result.capture.nodes.find((node) => node.id === "1:3")).toMatchObject({
    type: "RECTANGLE",
    selectable: true,
    clipRenderBounds: { x: 88, y: 8, width: 12, height: 35 }
  });
  expect(result.capture.nodes.find((node) => node.id === "1:5")).toMatchObject({
    visible: false,
    selectable: false
  });
  expect(JSON.stringify(result.capture.nodes)).not.toContain("fills");
});

test("capturePositionalEvidence maps 404", async () => {
  const client = createFigmaApiClient({
    baseUrl: "https://api.figma.test",
    fetchImpl: async () => new Response("missing", { status: 404 })
  });
  expect(
    await client.capturePositionalEvidence({
      token: "t",
      fileKey: "f",
      nodeId: "1:1"
    })
  ).toEqual({ ok: false, reason: "not_found" });
});

test("screenshot CDN text/html error page fails closed as screenshot_missing", async () => {
  const client = clientWithFixture({
    imageBody: new TextEncoder().encode("<html>cdn error</html>"),
    imageContentType: "text/html; charset=utf-8"
  });
  expect(
    await client.capturePositionalEvidence({
      token: "t",
      fileKey: "f",
      nodeId: "1:2"
    })
  ).toEqual({ ok: false, reason: "screenshot_missing" });
});

test("screenshot with image MIME but non-image bytes fails closed", async () => {
  const client = clientWithFixture({
    imageBody: new TextEncoder().encode("not-a-png"),
    imageContentType: "image/png"
  });
  expect(
    await client.capturePositionalEvidence({
      token: "t",
      fileKey: "f",
      nodeId: "1:2"
    })
  ).toEqual({ ok: false, reason: "screenshot_missing" });
});

test("capturePositionalEvidence times out while reading an unfinished screenshot body", async () => {
  let screenshotSignal: AbortSignal | null = null;
  const client = createFigmaApiClient({
    baseUrl: "https://api.figma.test",
    apiTimeoutMs: 100,
    screenshotTimeoutMs: 5,
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url.includes("/nodes?")) {
        return new Response(
          JSON.stringify({ nodes: { "1:2": { document: VALID_DOCUMENT } } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/images/")) {
        return new Response(
          JSON.stringify({ images: { "1:2": "https://cdn.test/slow.png" } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      screenshotSignal = init?.signal ?? null;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(TINY_PNG.subarray(0, 8));
            // Deliberately never close: models a CDN that returns 200 headers
            // and then leaves the image body unfinished.
          }
        }),
        { status: 200, headers: { "content-type": "image/png" } }
      );
    }
  });

  expect(
    await client.capturePositionalEvidence({
      token: "t",
      fileKey: "f",
      nodeId: "1:2"
    })
  ).toEqual({ ok: false, reason: "figma_api_timeout" });
  expect(screenshotSignal).not.toBeNull();
  expect((screenshotSignal as AbortSignal | null)?.aborted).toBe(true);
});

test("default Figma transport honors standard proxy env for screenshot downloads", async () => {
  let targetPort = 0;
  const target = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${targetPort}`);
    if (url.pathname.includes("/nodes")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ nodes: { "1:2": { document: VALID_DOCUMENT } } }));
      return;
    }
    if (url.pathname.includes("/images/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          images: { "1:2": `http://127.0.0.1:${targetPort}/shot.png` }
        })
      );
      return;
    }
    if (url.pathname === "/shot.png") {
      res.writeHead(200, {
        "content-type": "image/png",
        "content-length": String(TINY_PNG.byteLength)
      });
      res.end(Buffer.from(TINY_PNG));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) =>
    target.listen(0, "127.0.0.1", resolve)
  );
  targetPort = (target.address() as AddressInfo).port;

  let proxyConnects = 0;
  const sockets = new Set<Duplex>();
  const proxy = createServer();
  proxy.on("connect", (req, downstream, head) => {
    proxyConnects += 1;
    const [host, portRaw] = (req.url ?? "").split(":");
    const upstream = connect(Number(portRaw), host, () => {
      downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      downstream.pipe(upstream);
      upstream.pipe(downstream);
    });
    sockets.add(downstream);
    sockets.add(upstream);
    downstream.on("close", () => sockets.delete(downstream));
    upstream.on("close", () => sockets.delete(upstream));
    upstream.on("error", () => downstream.destroy());
  });
  await new Promise<void>((resolve) =>
    proxy.listen(0, "127.0.0.1", resolve)
  );
  const proxyPort = (proxy.address() as AddressInfo).port;

  const proxyKeys = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy"
  ] as const;
  const previous = Object.fromEntries(
    proxyKeys.map((key) => [key, process.env[key]])
  );
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;
  process.env.HTTP_PROXY = proxyUrl;
  process.env.HTTPS_PROXY = proxyUrl;
  process.env.http_proxy = proxyUrl;
  process.env.https_proxy = proxyUrl;
  process.env.NO_PROXY = "";
  process.env.no_proxy = "";

  try {
    const client = createFigmaApiClient({
      baseUrl: `http://127.0.0.1:${targetPort}`,
      apiTimeoutMs: 2_000,
      screenshotTimeoutMs: 2_000
    });
    const result = await client.capturePositionalEvidence({
      token: "figd_x",
      fileKey: "file",
      nodeId: "1:2"
    });
    expect(result.ok).toBe(true);
    expect(proxyConnects).toBeGreaterThan(0);
  } finally {
    for (const key of proxyKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const socket of sockets) socket.destroy();
    await Promise.all([
      new Promise<void>((resolve) => proxy.close(() => resolve())),
      new Promise<void>((resolve) => target.close(() => resolve()))
    ]);
  }
});

test("malformed root missing type fails closed", async () => {
  const client = clientWithFixture({
    document: {
      id: "1:2",
      name: "Frame",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 }
    }
  });
  expect(
    await client.capturePositionalEvidence({
      token: "t",
      fileKey: "f",
      nodeId: "1:2"
    })
  ).toEqual({ ok: false, reason: "malformed_figma_response" });
});

test("malformed root missing bounds fails closed", async () => {
  const client = clientWithFixture({
    document: { id: "1:2", name: "Frame", type: "FRAME" }
  });
  expect(
    await client.capturePositionalEvidence({
      token: "t",
      fileKey: "f",
      nodeId: "1:2"
    })
  ).toEqual({ ok: false, reason: "malformed_figma_response" });
});

test("malformed child missing id/name fails closed (no silent skip)", async () => {
  const client = clientWithFixture({
    document: {
      id: "1:2",
      name: "Frame",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 },
      children: [{ name: "orphan-without-id", type: "TEXT" }]
    }
  });
  expect(
    await client.capturePositionalEvidence({
      token: "t",
      fileKey: "f",
      nodeId: "1:2"
    })
  ).toEqual({ ok: false, reason: "malformed_figma_response" });
});

test("malformed child missing type fails closed (no UNKNOWN downgrade)", async () => {
  const client = clientWithFixture({
    document: {
      id: "1:2",
      name: "Frame",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 },
      children: [
        {
          id: "1:3",
          name: "Title",
          absoluteBoundingBox: { x: 1, y: 1, width: 10, height: 10 }
        }
      ]
    }
  });
  expect(
    await client.capturePositionalEvidence({
      token: "t",
      fileKey: "f",
      nodeId: "1:2"
    })
  ).toEqual({ ok: false, reason: "malformed_figma_response" });
});
