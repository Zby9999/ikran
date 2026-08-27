import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Resolve the Runtime's local transport path without exceeding Unix-domain
 * socket limits. Installed plugins can live under a deeply nested cache path,
 * so long state directories use a deterministic, user-private temp path.
 */
export function resolveRuntimeSocketPath(
  stateDirectory,
  {
    platform = process.platform,
    tempDirectory = tmpdir(),
    uid = typeof process.getuid === "function" ? process.getuid() : "user"
  } = {}
) {
  const workspaceSocket = path.join(stateDirectory, "runtime-mcp.sock");
  if (platform === "win32" || Buffer.byteLength(workspaceSocket) < 100) {
    return workspaceSocket;
  }

  const digest = createHash("sha256")
    .update(path.resolve(stateDirectory))
    .digest("hex")
    .slice(0, 24);
  const privateTempSocket = path.join(tempDirectory, `ikran-${digest}.sock`);
  if (Buffer.byteLength(privateTempSocket) < 100) return privateTempSocket;
  return `/tmp/ikran-${uid}-${digest}.sock`;
}
