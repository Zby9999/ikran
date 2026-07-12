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

test("validateToken succeeds on /v1/me 200", async () => {
  const client = createFigmaApiClient({
    baseUrl: "https://api.figma.test",
    fetchImpl: async (input) => {
      expect(String(input)).toBe("https://api.figma.test/v1/me");
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

test("capturePositionalEvidence builds screenshot data URL and node index", async () => {
  const png = Buffer.from([137, 80, 78, 71]);
  const client = createFigmaApiClient({
    baseUrl: "https://api.figma.test",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/nodes?")) {
        return new Response(
          JSON.stringify({
            nodes: {
              "1:2": {
                document: {
                  id: "1:2",
                  name: "Frame",
                  type: "FRAME",
                  absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 },
                  children: [
                    {
                      id: "1:3",
                      name: "Title",
                      type: "TEXT",
                      absoluteBoundingBox: {
                        x: 10,
                        y: 10,
                        width: 40,
                        height: 12
                      }
                    }
                  ]
                }
              }
            }
          }),
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
        return new Response(png, {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      return new Response("miss", { status: 404 });
    }
  });

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
