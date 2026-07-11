// Playwright globalSetup: produce ONE `next build` into SHARED_BUILD_DIR before
// any worker runs. Each worker then serves this build via `next start` (see
// tests/fixtures.ts). Building once avoids N concurrent cold compiles.
//
// `next build` rewrites two committed files — tsconfig.json (may add distDir
// type globs) and next-env.d.ts (points the routes types reference at the
// build dir). We snapshot the REAL on-disk files after optionally sanitizing a
// polluted next-env.d.ts (e2e-build ref), then restore that snapshot on
// teardown / failure — preserving uncommitted tsconfig edits and avoiding a
// hardcoded tsconfig.json copy in test helpers.

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SHARED_BUILD_DIR } from "./e2e-constants";
import { beginE2eWorkspaceGuard, restoreWorkspaceFiles } from "./e2e-pristine";

const nextBin = path.join(process.cwd(), "node_modules", ".bin", "next");

export default async function globalSetup() {
  const { snapshots } = beginE2eWorkspaceGuard();
  rmSync(SHARED_BUILD_DIR, { recursive: true, force: true });

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        nextBin,
        ["build"],
        {
          env: { ...process.env, IKRAN_NEXT_DIST_DIR: SHARED_BUILD_DIR },
          stdio: ["ignore", "pipe", "pipe"],
          cwd: process.cwd(),
          shell: process.platform === "win32"
        }
      );
      let stderr = "";
      child.stdout?.on("data", () => {
        /* drop build stdout */
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString();
        if (stderr.length > 12000) stderr = stderr.slice(-12000);
      });
      child.on("error", (err) => reject(err));
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(`next build exited with code ${code}\n${stderr.slice(-6000)}`)
          );
      });
    });

    // Stamp the e2e dist so --prod MCP/launcher fail-closed guards pass (same as
    // `npm run build` post-step for the default `.next` dist).
    const { writeVersionStamp } = await import(
      pathToFileURL(
        path.join(process.cwd(), "lib/runtime/version-stamp.mjs")
      ).href
    );
    writeVersionStamp(process.cwd(), SHARED_BUILD_DIR);
  } catch (err) {
    restoreWorkspaceFiles(snapshots);
    rmSync(SHARED_BUILD_DIR, { recursive: true, force: true });
    throw err;
  }

  return async function globalTeardown() {
    restoreWorkspaceFiles(snapshots);
    rmSync(SHARED_BUILD_DIR, { recursive: true, force: true });
    // No broad pkill/taskkill: workers and MCP specs must tear down only the
    // child PID / process group they recorded (fixtures.ts killGroup,
    // helpers/mcp.ts killRecordedRuntime).
  };
}
