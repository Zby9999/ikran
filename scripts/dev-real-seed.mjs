#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = path.join(repoRoot, "scripts", "real-seed-evidence-agent-wrapper.mjs");
const nextBin = path.join(repoRoot, "node_modules", ".bin", "next");
const nextEnvPath = path.join(repoRoot, "next-env.d.ts");
const originalNextEnv = existsSync(nextEnvPath)
  ? readFileSync(nextEnvPath, "utf-8")
  : null;
const host = process.env.IKRAN_HOST || "127.0.0.1";
const port = process.env.IKRAN_PORT || "3000";

const env = {
  ...process.env,
  IKRAN_HOST: host,
  IKRAN_PORT: port,
  IKRAN_NEXT_DIST_DIR: process.env.IKRAN_NEXT_DIST_DIR || ".next-real-seed",
  IKRAN_SEED_EVIDENCE_ADAPTER: "cli",
  IKRAN_AGENT_CLI_COMMAND: process.env.IKRAN_AGENT_CLI_COMMAND || process.execPath,
  IKRAN_AGENT_CLI_ARGS:
    process.env.IKRAN_AGENT_CLI_ARGS || JSON.stringify([wrapper])
};

console.log("[ikran] seed_evidence_import adapter: cli");
console.log(`[ikran] adapter command: ${env.IKRAN_AGENT_CLI_COMMAND} ${env.IKRAN_AGENT_CLI_ARGS}`);
console.log("[ikran] real agent command: selected by Setup agent profile");
console.log(`[ikran] Next dist dir: ${env.IKRAN_NEXT_DIST_DIR}`);

const child = spawn(nextBin, ["dev", "-H", host, "-p", port], {
  cwd: repoRoot,
  env,
  stdio: "inherit"
});

process.on("exit", restoreNextEnv);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    restoreNextEnv();
    child.kill(signal);
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

child.on("exit", (code, signal) => {
  restoreNextEnv();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

function restoreNextEnv() {
  if (originalNextEnv !== null && existsSync(nextEnvPath)) {
    writeFileSync(nextEnvPath, originalNextEnv, "utf-8");
  }
}
