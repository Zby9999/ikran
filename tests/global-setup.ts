// Playwright globalSetup: produce ONE `next build` into SHARED_BUILD_DIR before
// any worker runs. Each worker then serves this build via `next start` (see
// tests/fixtures.ts). Building once avoids N concurrent cold compiles.
//
// `next build` rewrites two committed files — tsconfig.json (adds
// `<distDir>/types/**/*.ts` to `include`) and next-env.d.ts (points the routes
// types reference at the build dir). Both are snapshot/restored here so the
// committed files are left pristine after the run. The build dir itself lives
// under the gitignored `.next/e2e-build` and is removed in teardown.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SHARED_BUILD_DIR } from "./e2e-constants";

const nextBin = path.join(process.cwd(), "node_modules", ".bin", "next");

// Committed files that `next build` rewrites; restored verbatim in teardown.
const PRISTINE_FILES = [path.join(process.cwd(), "tsconfig.json"), path.join(process.cwd(), "next-env.d.ts")];

export default async function globalSetup() {
  rmSync(SHARED_BUILD_DIR, { recursive: true, force: true });

  const snapshots = PRISTINE_FILES.map((f) =>
    existsSync(f) ? { path: f, content: readFileSync(f, "utf-8") } : null
  );

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

  return async function globalTeardown() {
    for (const snap of snapshots) {
      if (snap) writeFileSync(snap.path, snap.content, "utf-8");
    }
    rmSync(SHARED_BUILD_DIR, { recursive: true, force: true });
    // Safety net: if any worker's `next start` escaped its group teardown
    // (e.g. a worker process crashed mid-test), reap lingering per-worker
    // servers by their fixture-specific command shape. Best-effort.
    try {
      spawn(
        process.platform === "win32" ? "taskkill" : "pkill",
        process.platform === "win32"
          ? ["/F", "/IM", "node.exe", "/FI", "WINDOWTITLE eq next start*"]
          : ["-9", "-f", "next start -H 127.0.0.1 -p"],
        { stdio: "ignore", detached: false }
      ).unref();
    } catch {
      /* ignore */
    }
  };
}