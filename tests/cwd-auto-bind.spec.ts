import http from "node:http";
import { expect, test } from "./fixtures";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getCwdCandidate } from "../lib/runtime/cwd-candidate";
import { projectPathsMatch } from "../lib/runtime/project";

let port = 3000;

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

// A /api/project/bind mock that records the requested path and returns a bound
// project, so the UI auto-bind flow can be exercised without touching the
// real Runtime-global active-project pointer (which is shared with other spec
// files). Real `.ikran/` creation is already covered by
// project-folder-binding.spec.ts.
function mockBind(page: import("@playwright/test").Page, dir: string) {
  const requested: { path?: string }[] = [];
  void page.route("**/api/project/bind", async (route) => {
    requested.push(route.request().postDataJSON() as { path?: string });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        project: { path: dir, name: path.basename(dir) },
        events: { project_created: "e1", folder_selected: "e2" }
      })
    });
  });
  return {
    requested,
    paths: () => requested.map((r) => r.path)
  };
}

test.describe("Ikran Issue 2 supplement — cwd auto-bind", () => {
  // ---------- Safety gate (getCwdCandidate) — unit ----------
  // The Runtime reads IKRAN_CWD (not process.cwd()) and classifies the folder.
  // These run in the test process; the shared webServer process has IKRAN_CWD
  // unset, so they do not affect it.

  test("getCwdCandidate: empty folder -> init (auto-bindable)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-cwd-init-"));
    try {
      process.env.IKRAN_CWD = dir;
      const candidate = await getCwdCandidate();
      expect(candidate).not.toBeNull();
      expect(candidate!.path).toBe(dir);
      expect(candidate!.kind).toBe("init");
    } finally {
      delete process.env.IKRAN_CWD;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("getCwdCandidate: existing .ikran -> resume (auto-bindable)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-cwd-resume-"));
    try {
      mkdirSync(path.join(dir, ".ikran"), { recursive: true });
      writeFileSync(
        path.join(dir, ".ikran/config.json"),
        JSON.stringify({
          path: dir,
          name: path.basename(dir),
          created_at: "t",
          updated_at: "t"
        })
      );
      process.env.IKRAN_CWD = dir;
      const candidate = await getCwdCandidate();
      expect(candidate).not.toBeNull();
      expect(candidate!.kind).toBe("resume");
    } finally {
      delete process.env.IKRAN_CWD;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("getCwdCandidate: non-empty non-project folder -> manual (not auto-bindable)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-cwd-manual-"));
    try {
      writeFileSync(path.join(dir, "keep-me.txt"), "hi");
      process.env.IKRAN_CWD = dir;
      const candidate = await getCwdCandidate();
      expect(candidate).not.toBeNull();
      expect(candidate!.kind).toBe("manual");
    } finally {
      delete process.env.IKRAN_CWD;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("getCwdCandidate: IKRAN_CWD unset -> null", async () => {
    delete process.env.IKRAN_CWD;
    const candidate = await getCwdCandidate();
    expect(candidate).toBeNull();
  });

  // ---------- Symlink equivalence (projectPathsMatch) — unit ----------

  test("projectPathsMatch resolves symlinks: same physical folder via different paths matches", () => {
    const real = mkdtempSync(path.join(tmpdir(), "ikran-symlink-real-"));
    const linkParent = mkdtempSync(path.join(tmpdir(), "ikran-symlink-parent-"));
    const link = path.join(linkParent, "link");
    symlinkSync(real, link);
    try {
      expect(projectPathsMatch(link, real)).toBe(true);
      expect(projectPathsMatch(real, link)).toBe(true);
      const other = mkdtempSync(path.join(tmpdir(), "ikran-symlink-other-"));
      expect(projectPathsMatch(link, other)).toBe(false);
      rmSync(other, { recursive: true, force: true });
    } finally {
      rmSync(real, { recursive: true, force: true });
      rmSync(linkParent, { recursive: true, force: true });
    }
  });

  // ---------- UI auto-bind flow (mocked /api/project, mocked /bind) ----------

  test("UI does NOT auto-bind an `init` cwd; a one-click Initialize binds it", async ({ page, runtime }) => {
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-cwd-ui-init-"));
    try {
      const bind = mockBind(page, dir);
      await page.route("**/api/project", (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            project: null,
            cwd_candidate: { path: dir, kind: "init" }
          })
        })
      );

      await page.goto(runtime.baseURL + "/");

      // No silent auto-bind: the Initialize button is shown and bind has not run.
      await expect(page.getByTestId("folder-helper")).toContainText(
        "Click to initialize the project folder"
      );
      await expect(page.getByTestId("project-path")).toHaveText("");
      expect(bind.paths()).not.toContain(dir);

      // One click on the folder row binds the cwd candidate.
      await page.getByTestId("select-folder-button").click();
      await expect.poll(() => bind.paths()).toContainEqual(dir);
      await expect(page.getByTestId("project-path")).toHaveText(dir);
    } finally {
      await page.unroute("**/api/project");
      await page.unroute("**/api/project/bind").catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("UI auto-binds a `resume` cwd candidate without a confirm", async ({ page, runtime }) => {
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-cwd-ui-resume-"));
    try {
      const bind = mockBind(page, dir);
      await page.route("**/api/project", (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            project: null,
            cwd_candidate: { path: dir, kind: "resume" }
          })
        })
      );

      await page.goto(runtime.baseURL + "/");
      await expect.poll(() => bind.paths()).toContainEqual(dir);
      await expect(page.getByTestId("project-path")).toHaveText(dir);
    } finally {
      await page.unroute("**/api/project");
      await page.unroute("**/api/project/bind").catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("UI does NOT auto-bind a `manual` cwd; a one-click Initialize binds alongside", async ({ page, runtime }) => {
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-cwd-ui-manual-"));
    writeFileSync(path.join(dir, "keep-me.txt"), "hi");
    try {
      const bind = mockBind(page, dir);
      await page.route("**/api/project", (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            project: null,
            cwd_candidate: { path: dir, kind: "manual" }
          })
        })
      );

      await page.goto(runtime.baseURL + "/");

      // No silent bind: the Initialize button is shown and bind has not run.
      await expect(page.getByTestId("folder-helper")).toContainText(
        "Initialize .ikran in this folder"
      );
      await expect(page.getByTestId("project-path")).toHaveText("");
      expect(existsSync(path.join(dir, ".ikran", "config.json"))).toBe(false);
      expect(bind.paths()).not.toContain(dir);

      // One click on the folder row binds (creating .ikran alongside keep-me.txt).
      await page.getByTestId("select-folder-button").click();
      await expect.poll(() => bind.paths()).toContainEqual(dir);
      await expect(page.getByTestId("project-path")).toHaveText(dir);
    } finally {
      await page.unroute("**/api/project");
      await page.unroute("**/api/project/bind").catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---------- Real API shape ----------

  test("GET /api/project exposes cwd_candidate (null when IKRAN_CWD is not forwarded)", async ({ page, runtime }) => {
    port = runtime.port;
    let sessionToken: string | null = null;
    await page.route("**/api/**", async (route) => {
      const token = route.request().headers()["x-ikran-session"];
      if (token) {
        sessionToken = token;
      }
      await route.continue();
    });

    await page.goto(runtime.baseURL + "/");
    await expect(page.getByTestId("runtime-helper")).toContainText(
      "Local runtime connected"
    );

    if (!sessionToken) {
      throw new Error("Runtime session token was not captured from the UI request");
    }
    const token = sessionToken;

    const result = await rawGet("/api/project", {
      host: `localhost:${port}`,
      "x-ikran-session": token
    });
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty("cwd_candidate");
    expect(body).toHaveProperty("project");
    // cwd_candidate is null when the server was launched without forwarding
    // IKRAN_CWD (e.g. `npm run dev`). If the server was launched via the ikran
    // launcher it is an object with { path, kind } — accept either shape.
    if (body.cwd_candidate !== null) {
      expect(typeof body.cwd_candidate.path).toBe("string");
      expect(["resume", "init", "manual"]).toContain(body.cwd_candidate.kind);
    }
  });
});