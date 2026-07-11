import { expect, test } from "./fixtures";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectPathsMatch } from "../lib/runtime/project";
import { rawGet as httpGet, rawPost as httpPost } from "./helpers/http";

let port = 3000;
let baseURL = "http://localhost:3000";
let testFolder = "";
let otherFolder = "";

function rawPost(
  route: string,
  body: unknown,
  headers: Record<string, string>
) {
  return httpPost(port, route, body, headers);
}

function rawGet(route: string, headers: Record<string, string>) {
  return httpGet(port, route, headers);
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
    expect(projectPathsMatch(bindBody.project.path, testFolder)).toBe(true);
    expect(bindBody.events.project_created).toBeDefined();
    expect(bindBody.events.folder_selected).toBeDefined();

    // .ikran metadata should exist.
    expect(existsSync(`${testFolder}/.ikran/config.json`)).toBe(true);
    expect(existsSync(`${testFolder}/.ikran/ikran.db`)).toBe(true);
    const boundPath: string = bindBody.project.path;

    // SQLite should contain the recorded events.
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(`${testFolder}/.ikran/ikran.db`);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row: { name: string }) => row.name);
    expect(tables).toContain("events");
    expect(tables).not.toContain("tasks");
    const eventCount = db.prepare("SELECT COUNT(*) as c FROM events").get().c;
    expect(eventCount).toBeGreaterThanOrEqual(2);
    const types = (
      db.prepare("SELECT type FROM events ORDER BY id ASC").all() as Array<{
        type: string;
      }>
    ).map((r) => r.type);
    expect(types).toContain("project_created");
    expect(types).toContain("folder_selected");
    db.close();

    // Config should contain the project path.
    const config = JSON.parse(readFileSync(`${testFolder}/.ikran/config.json`, "utf-8"));
    expect(projectPathsMatch(config.path, testFolder)).toBe(true);

    // Active project endpoint should recover the binding after refresh.
    const activeResult = await rawGet("/api/project", {
      host: `localhost:${port}`,
      "x-ikran-session": token
    });
    expect(activeResult.status).toBe(200);
    const activeBody = JSON.parse(activeResult.body);
    expect(activeBody.ok).toBe(true);
    expect(projectPathsMatch(activeBody.project.path, testFolder)).toBe(true);

    // Browser UI should also recover the binding after refresh.
    await page.reload();
    await expect(page.getByTestId("folder-helper")).toContainText(
      `Complete! ${boundPath}`
    );
    await expect(page.getByTestId("select-folder-button")).not.toContainText(
      "Complete!"
    );
    await expect(page.getByTestId("project-path")).toHaveText(boundPath);
    await expect(page.getByText("Connect Your Agent")).toHaveCount(0);
    await expect(page.getByLabel("Agent choices")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Codex" })).toHaveCount(0);

    const startButton = page.getByRole("button", { name: "Start Building" });
    await expect(startButton).toBeEnabled();

    expect(activeBody.connected_agent).toBeUndefined();

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
    const activeAfterRebindBody = JSON.parse(activeAfterRebind.body);
    expect(activeAfterRebindBody.connected_agent).toBeUndefined();
    expect(projectPathsMatch(activeAfterRebindBody.project.path, testFolder)).toBe(
      true
    );

    await page.reload();
    await expect(page.getByTestId("folder-helper")).toContainText(
      `Complete! ${boundPath}`
    );
    await expect(startButton).toBeEnabled();
    await startButton.click();
    await expect(page.getByTestId("seed-workbench")).toBeVisible();
    await page.getByRole("button", { name: "Back to setup" }).click();
    await expect(page.getByTestId("folder-helper")).toContainText(
      `Complete! ${boundPath}`
    );

    // Single-project-single-flow: binding a different folder fails closed.
    // Do NOT switch; do NOT create .ikran on the rejected path.
    otherFolder = mkdtempSync(path.join(tmpdir(), "ikran-e2e-other-"));
    const bindOtherResult = await rawPost(
      "/api/project/bind",
      { path: otherFolder },
      { host: `localhost:${port}`, "x-ikran-session": token }
    );
    expect(bindOtherResult.status).toBe(409);
    const bindOtherBody = JSON.parse(bindOtherResult.body);
    expect(bindOtherBody.ok).toBe(false);
    expect(bindOtherBody.error).toBe("project_mismatch");
    expect(existsSync(`${otherFolder}/.ikran`)).toBe(false);

    const folderAConfig = JSON.parse(
      readFileSync(`${testFolder}/.ikran/config.json`, "utf-8")
    );
    expect(folderAConfig.connected_agent).toBeUndefined();
    expect(projectPathsMatch(folderAConfig.path, testFolder)).toBe(true);

    const activeAfterMismatch = await rawGet("/api/project", {
      host: `localhost:${port}`,
      "x-ikran-session": token
    });
    const activeAfterMismatchBody = JSON.parse(activeAfterMismatch.body);
    expect(activeAfterMismatchBody.ok).toBe(true);
    expect(
      projectPathsMatch(activeAfterMismatchBody.project.path, testFolder)
    ).toBe(true);

    await page.reload();
    await expect(page.getByTestId("folder-helper")).toContainText(
      `Complete! ${boundPath}`
    );
    await expect(page.getByTestId("project-path")).toHaveText(boundPath);
    await expect(page.getByRole("button", { name: "Start Building" })).toBeEnabled();
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
