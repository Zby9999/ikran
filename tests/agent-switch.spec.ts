import http from "node:http";
import { expect, test } from "./fixtures";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let port = 3000;
let baseURL = "http://localhost:3000";
let testFolder = "";

function rawPost(
  route: string,
  body: unknown,
  headers: Record<string, string>
): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const json = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: route,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(json),
          ...headers
        }
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
    req.write(json);
    req.end();
  });
}

async function bindTestFolder(token: string, folderPath: string) {
  const bindResult = await rawPost(
    "/api/project/bind",
    { path: folderPath },
    { host: `localhost:${port}`, "x-ikran-session": token }
  );
  expect(bindResult.status).toBe(200);
  expect(JSON.parse(bindResult.body).ok).toBe(true);
}

async function captureSessionToken(page: import("@playwright/test").Page) {
  let sessionToken: string | null = null;
  await page.route("**/api/**", async (route) => {
    const token = route.request().headers()["x-ikran-session"];
    if (token) {
      sessionToken = token;
    }
    await route.continue();
  });
  await page.goto(baseURL + "/");
  await expect(page.getByTestId("runtime-helper")).toContainText(
    "Local runtime connected"
  );
  if (!sessionToken) {
    throw new Error("Runtime session token was not captured from the UI request");
  }
  return sessionToken;
}

test.describe("Ikran setup — agent switching", () => {
  test.beforeEach(async ({ runtime }) => {
    port = runtime.port;
    baseURL = runtime.baseURL;
    testFolder = mkdtempSync(path.join(tmpdir(), "ikran-agent-switch-"));
  });

  test.afterEach(() => {
    if (testFolder) {
      rmSync(testFolder, { recursive: true, force: true });
      testFolder = "";
    }
  });

  test("preserves connected agent when a switch attempt fails", async ({ page }) => {
    const token = await captureSessionToken(page);
    await bindTestFolder(token, testFolder);
    await page.reload();
    await expect(page.getByTestId("folder-helper")).toContainText(
      `Complete! ${testFolder}`
    );

    const startButton = page.getByRole("button", { name: "Start Building" });
    await page.getByRole("button", { name: "Codex" }).click();
    await expect(page.getByTestId("agent-helper")).toContainText("Codex connected");
    await expect(startButton).toBeEnabled();

    await page.route("**/api/agent/connect", async (route) => {
      const body = route.request().postDataJSON() as { agent?: string };
      if (body.agent === "cursor") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "agent_unavailable" })
        });
        return;
      }
      await route.continue();
    });

    await page.getByRole("button", { name: "Cursor" }).click();
    await expect(page.getByTestId("agent-helper")).toContainText(
      "This agent is not available right now"
    );
    await expect(startButton).toBeEnabled();
    await expect(page.getByRole("button", { name: "Codex" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Cursor" })).toBeEnabled();
  });

  test("ignores duplicate clicks while connecting", async ({ page }) => {
    const token = await captureSessionToken(page);
    await bindTestFolder(token, testFolder);
    await page.reload();
    await expect(page.getByTestId("folder-helper")).toContainText(
      `Complete! ${testFolder}`
    );

    let connectCalls = 0;
    await page.route("**/api/agent/connect", async (route) => {
      connectCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    });

    const cursorButton = page.getByRole("button", { name: "Cursor" });
    await cursorButton.click();
    await expect(cursorButton).toBeDisabled();
    await cursorButton.click({ force: true });

    await expect(page.getByTestId("agent-helper")).toContainText("Cursor connected", {
      timeout: 10_000
    });
    expect(connectCalls).toBe(1);
  });
});
