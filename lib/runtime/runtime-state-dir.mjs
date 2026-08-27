import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Resolve the control-plane state for one installed Ikran version.
 *
 * Project research data remains in `{project}/.ikran`. This directory only
 * owns the Runtime endpoint, MCP socket, active-project pointer, and logs.
 * Version-scoping prevents a newly installed plugin from attaching to an
 * older Runtime that happens to be listening in the legacy global state dir.
 */
export function resolveRuntimeStateDir({
  appDir,
  env = process.env,
  homeDir = homedir()
}) {
  const override = env.IKRAN_STATE_DIR;
  if (typeof override === "string" && override.trim().length > 0) {
    return path.resolve(override.trim());
  }

  const version = readIkranPackageVersion(appDir);
  return path.join(homeDir, ".ikran", "runtimes", version);
}

export function readIkranPackageVersion(appDir) {
  const manifest = JSON.parse(
    readFileSync(path.join(appDir, "package.json"), "utf8")
  );
  const version = manifest?.version;
  if (
    typeof version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
  ) {
    throw new Error("Ikran package version is missing or invalid.");
  }
  return version;
}
