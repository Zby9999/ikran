import http from "node:http";
import { expect, test } from "./fixtures";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let port = 3000;
let baseURL = "http://localhost:3000";
let testFolder = "";
let otherFolder = "";

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

async function ensureConnectedAgent(
  page: import("@playwright/test").Page,
  agentName: "Codex" | "Cursor" | "Claude Code"
) {
  const helper = page.getByTestId("agent-helper");
  if ((await helper.textContent())?.includes(`${agentName} connected`)) {
    return;
  }

  await page.getByRole("button", { name: agentName }).click();
  await expect(helper).toContainText(`${agentName} connected`);
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
    if (otherFolder) {
      rmSync(otherFolder, { recursive: true, force: true });
      otherFolder = "";
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
    await ensureConnectedAgent(page, "Codex");
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

    const helperText = (await page.getByTestId("agent-helper").textContent()) ?? "";
    const targetAgent = helperText.includes("Cursor connected") ? "Codex" : "Cursor";
    const targetButton = page.getByRole("button", { name: targetAgent });
    await targetButton.click();
    await expect(targetButton).toBeDisabled();
    await targetButton.click({ force: true });

    await expect(page.getByTestId("agent-helper")).toContainText(`${targetAgent} connected`, {
      timeout: 10_000
    });
    expect(connectCalls).toBe(1);
  });
});
