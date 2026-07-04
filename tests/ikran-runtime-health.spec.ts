import http from "node:http";
import { expect, test } from "./fixtures";

let port = 3000;
let baseURL = "http://localhost:3000";

// Low-level GET with full header control (Node http). This lets us spoof
// Host / Origin to prove the Runtime's same-origin + session enforcement
// independently of the browser, which cannot override those forbidden headers.
function rawGet(
  headers: Record<string, string>
): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/health",
        method: "GET",
        headers
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.end();
  });
}

test.describe("Ikran Issue 01 — local workbench runtime health", () => {
  test.beforeEach(async ({ runtime }) => {
    port = runtime.port;
    baseURL = runtime.baseURL;
  });

  test("renders the existing project setup screen and reaches the same-origin Runtime", async ({
    page
  }) => {
    // Capture the real session token the same-origin UI sends, without leaking
    // it into the DOM. We reuse it for the API-level security assertions below.
    let sessionToken: string | null = null;
    await page.route("**/api/health", async (route) => {
      const token = route.request().headers()["x-ikran-session"];
      if (token) {
        sessionToken = token;
      }
      await route.continue();
    });

    await page.goto(baseURL + "/");

    // The designer's existing (Figma-owned) project setup screen.
    await expect(page.getByText("Project set up...")).toBeVisible();
    await expect(page.getByText("Select a Folder")).toBeVisible();
    await expect(page.getByText("Connect Your Agent")).toBeVisible();

    // Same-origin Runtime health + live SSE heartbeat.
    await expect(page.getByTestId("runtime-helper")).toContainText(
      "Local runtime connected"
    );
    await expect(page.getByTestId("runtime-service")).toHaveText("ikran-runtime");
    await expect(page.getByTestId("runtime-helper")).not.toContainText(
      "heartbeat"
    );

    if (!sessionToken) {
      throw new Error(
        "Runtime session token was not captured from the UI request"
      );
    }
    const token = sessionToken;

    // Valid token + same-origin localhost -> 200 (proves the happy path at the
    // API boundary, not just through the browser).
    const ok = await rawGet({ host: `localhost:${port}`, "x-ikran-session": token });
    expect(ok.status).toBe(200);
    expect(ok.body).toContain("ikran-runtime");

    // No session token -> 403 (fail-closed).
    const noToken = await rawGet({ host: `localhost:${port}` });
    expect(noToken.status).toBe(403);

    // Bad session token -> 403.
    const badToken = await rawGet({
      host: `localhost:${port}`,
      "x-ikran-session": "not-the-real-token"
    });
    expect(badToken.status).toBe(403);

    // Valid token but cross-origin Origin -> 403 (isolates the origin check).
    const crossOrigin = await rawGet({
      host: `localhost:${port}`,
      origin: "https://evil.example",
      "x-ikran-session": token
    });
    expect(crossOrigin.status).toBe(403);

    // Valid token but nonlocal Host -> 403 (isolates the Host / DNS-rebinding
    // check).
    const nonlocalHost = await rawGet({
      host: "evil.example",
      "x-ikran-session": token
    });
    expect(nonlocalHost.status).toBe(403);
  });
});
