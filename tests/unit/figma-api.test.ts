import { afterEach, beforeEach, expect, test } from "vitest";
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
  children: [
    {
      id: "1:3",
      name: "Title",
      type: "TEXT",
      absoluteBoundingBox: { x: 10, y: 10, width: 40, height: 12 }
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
    depth: 1
  });
  expect(result.capture.frame.name).toBe("Frame");
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
