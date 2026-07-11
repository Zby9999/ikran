import { expect, test } from "./fixtures";
import { rawGet as httpGet } from "./helpers/http";

// Ikran Issue 02/01 — Workbench URL + session shell.
//
// Migrated from the old "capture token + hit /api/health" framing to the new
// Workbench URL semantics: the Runtime returns a localhost URL
// `http://127.0.0.1:{port}/?session={token}` (printed by `bin/ikran.mjs`,
// returned by the `open_workbench` MCP tool). Opening that URL in a browser
// must render the shell, reach the same-origin Runtime health, and keep an SSE
// heartbeat — while the privileged `/api/*` surface still rejects a missing,
// wrong, or cross-origin token.
//
// The `runtime` fixture spawns `next start` directly (no IKRAN_SESSION_TOKEN),
// so `lib/runtime/session.ts` generates a startup token exactly as before; we
// capture it from the page's same-origin `/api/health` call (the page injects
// it into the request header) and reuse it for the API-level assertions.

let port = 3000;
let baseURL = "http://localhost:3000";

// Low-level GET with full header control (Node http). This lets us spoof
// Host / Origin to prove the Runtime's same-origin + session enforcement
// independently of the browser, which cannot override those forbidden headers.
function rawGet(headers: Record<string, string>) {
  return httpGet(port, "/api/health", headers);
}

test.describe("Ikran Issue 02/01 — Workbench URL opens the session shell", () => {
  test.beforeEach(async ({ runtime }) => {
    port = runtime.port;
    baseURL = runtime.baseURL;
  });

  test("the Workbench URL form opens the shell and reaches the same-origin Runtime", async ({
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

    // First load: wait until the Runtime connects. This also guarantees the
    // page's same-origin /api/health request has fired, so the route above has
    // captured the startup token from its `x-ikran-session` header.
    await page.goto(baseURL + "/");
    await expect(page.getByTestId("runtime-label")).toContainText(
      "Runtime connected"
    );

    if (!sessionToken) {
      throw new Error(
        "Runtime session token was not captured from the UI request"
      );
    }
    const token = sessionToken;

    // The canonical Workbench URL the Agent returns / the designer copies to a
    // system browser. Navigating it must render the shell + health + SSE.
    const workbenchUrl = `http://127.0.0.1:${port}/?session=${token}`;
    await page.goto(workbenchUrl);

    // The designer's existing (Figma-owned) project setup screen renders from
    // the Workbench URL (the "copy to system browser" path works).
    await expect(page.getByText("Project set up...")).toBeVisible();
    await expect(page.getByText("Project Folder", { exact: true })).toBeVisible();
    await expect(page.getByText("Connect Your Agent")).toHaveCount(0);
    await expect(page.getByLabel("Agent choices")).toHaveCount(0);

    // Same-origin Runtime health + live SSE heartbeat, reached via the explicit
    // Workbench URL form.
    await expect(page.getByTestId("runtime-label")).toContainText(
      "Runtime connected"
    );
    await expect(page.getByTestId("runtime-service")).toHaveText("ikran-runtime");
    await expect(page.getByTestId("runtime-label")).not.toContainText(
      "heartbeat"
    );

    // Valid token + same-origin localhost -> 200 (proves the happy path at the
    // API boundary, not just through the browser).
    const ok = await rawGet({ host: `localhost:${port}`, "x-ikran-session": token });
    expect(ok.status).toBe(200);
    expect(ok.body).toContain("ikran-runtime");

    // No session token -> 403 (fail-closed). This is the "缺失/错误 token 被拒绝"
    // acceptance criterion at the API boundary.
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