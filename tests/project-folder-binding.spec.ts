import http from "node:http";
import { expect, test } from "./fixtures";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

function rawGet(
  route: string,
  headers: Record<string, string>
): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: route,
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

test.describe("Ikran Issue 02 — project folder binding and .ikran metadata", () => {
  test.beforeEach(async ({ runtime }) => {
    port = runtime.port;
    baseURL = runtime.baseURL;
    testFolder = mkdtempSync(path.join(tmpdir(), "ikran-e2e-"));
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

  test("binds a folder through the Runtime API and creates .ikran metadata", async ({ page }) => {
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
    const token = sessionToken;

    // Bind the test folder through the Runtime API.
    const bindResult = await rawPost(
      "/api/project/bind",
      { path: testFolder },
      { host: `localhost:${port}`, "x-ikran-session": token }
    );
    expect(bindResult.status).toBe(200);
    const bindBody = JSON.parse(bindResult.body);
    expect(bindBody.ok).toBe(true);
    expect(bindBody.project.path).toBe(testFolder);
    expect(bindBody.events.project_created).toBeDefined();
    expect(bindBody.events.folder_selected).toBeDefined();

    // .ikran metadata should exist.
    expect(existsSync(`${testFolder}/.ikran/config.json`)).toBe(true);
    expect(existsSync(`${testFolder}/.ikran/ikran.db`)).toBe(true);
    expect(existsSync(`${testFolder}/.ikran/events.jsonl`)).toBe(true);

    // SQLite should contain the recorded events.
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(`${testFolder}/.ikran/ikran.db`);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row: { name: string }) => row.name);
    expect(tables).toContain("events");
    const eventCount = db.prepare("SELECT COUNT(*) as c FROM events").get().c;
    expect(eventCount).toBeGreaterThanOrEqual(2);
    db.close();

    // Config should contain the project path.
    const config = JSON.parse(readFileSync(`${testFolder}/.ikran/config.json`, "utf-8"));
    expect(config.path).toBe(testFolder);

    // events.jsonl should contain project_created and folder_selected.
    const eventsJsonl = readFileSync(`${testFolder}/.ikran/events.jsonl`, "utf-8");
    const events = eventsJsonl
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const types = events.map((e) => e.type);
    expect(types).toContain("project_created");
    expect(types).toContain("folder_selected");

    // Active project endpoint should recover the binding after refresh.
    const activeResult = await rawGet("/api/project", {
      host: `localhost:${port}`,
      "x-ikran-session": token
    });
    expect(activeResult.status).toBe(200);
    const activeBody = JSON.parse(activeResult.body);
    expect(activeBody.ok).toBe(true);
    expect(activeBody.project.path).toBe(testFolder);

    // Browser UI should also recover the binding after refresh.
    await page.reload();
    await expect(page.getByTestId("folder-helper")).toContainText(
      `Complete! ${testFolder}`
    );
    await expect(page.getByTestId("select-folder-button")).not.toContainText(
      "Complete!"
    );
    await expect(page.getByTestId("project-path")).toHaveText(testFolder);
    await expect(page.getByRole("button", { name: "Codex" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Cursor" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Claude Code" })).toBeEnabled();

    const startButton = page.getByRole("button", { name: "Start Building" });
    await expect(startButton).toBeDisabled();
    await page.getByRole("button", { name: "Codex" }).click();
    await expect(page.getByTestId("agent-helper")).toContainText("Codex connected");
    await expect(startButton).toBeEnabled();

    const mismatchResult = await rawPost(
      "/api/agent/connect",
      { agent: "codex", projectPath: "/tmp/not-the-active-project" },
      { host: `localhost:${port}`, "x-ikran-session": token }
    );
    expect(mismatchResult.status).toBe(409);
    expect(JSON.parse(mismatchResult.body).error).toBe("project_mismatch");

    await page.reload();
    await expect(page.getByTestId("agent-helper")).toContainText("Codex connected");
    await expect(startButton).toBeEnabled();

    const persistedConfig = JSON.parse(
      readFileSync(`${testFolder}/.ikran/config.json`, "utf-8")
    );
    expect(persistedConfig.connected_agent).toBeUndefined();

    const rebindSameResult = await rawPost(
      "/api/project/bind",
      { path: testFolder },
      { host: `localhost:${port}`, "x-ikran-session": token }
    );
    expect(rebindSameResult.status).toBe(200);
    const rebindSameBody = JSON.parse(rebindSameResult.body);
    expect(rebindSameBody.project.connected_agent).toBeUndefined();

    const rebindSameConfig = JSON.parse(
      readFileSync(`${testFolder}/.ikran/config.json`, "utf-8")
    );
    expect(rebindSameConfig.connected_agent).toBeUndefined();

    const activeAfterRebind = await rawGet("/api/project", {
      host: `localhost:${port}`,
      "x-ikran-session": token
    });
    expect(JSON.parse(activeAfterRebind.body).connected_agent).toBe("codex");

    await page.reload();
    await expect(page.getByTestId("agent-helper")).toContainText("Codex connected");
    await expect(startButton).toBeEnabled();

    otherFolder = mkdtempSync(path.join(tmpdir(), "ikran-e2e-other-"));
    const bindOtherResult = await rawPost(
      "/api/project/bind",
      { path: otherFolder },
      { host: `localhost:${port}`, "x-ikran-session": token }
    );
    expect(bindOtherResult.status).toBe(200);
    expect(JSON.parse(bindOtherResult.body).project.path).toBe(otherFolder);
    expect(
      JSON.parse(readFileSync(`${otherFolder}/.ikran/config.json`, "utf-8"))
        .connected_agent
    ).toBeUndefined();

    const folderAConfig = JSON.parse(
      readFileSync(`${testFolder}/.ikran/config.json`, "utf-8")
    );
    expect(folderAConfig.connected_agent).toBeUndefined();

    await page.reload();
    await expect(page.getByTestId("folder-helper")).toContainText(
      `Complete! ${otherFolder}`
    );
    await expect(page.getByTestId("agent-helper")).toContainText("Codex connected");
    await expect(startButton).toBeEnabled();
  });

  test("rejects invalid project folders", async ({ page }) => {
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
      throw new Error("Runtime session token was not captured");
    }
    const token = sessionToken;

    const badResult = await rawPost(
      "/api/project/bind",
      { path: "/path/that/does/not/exist" },
      { host: `localhost:${port}`, "x-ikran-session": token }
    );
    expect(badResult.status).toBe(400);
    const badBody = JSON.parse(badResult.body);
    expect(badBody.ok).toBe(false);
    expect(badBody.error).toBe("path_not_found");
  });
});
