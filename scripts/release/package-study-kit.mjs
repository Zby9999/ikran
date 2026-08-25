#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

import { buildStudyRuntime } from "./build-study-runtime.mjs";
import {
  assertProdBuildMatchesSource,
  writeVersionStamp
} from "../../lib/runtime/version-stamp.mjs";

const EPHEMERAL_NAMES = new Set([
  "config.json",
  "runtime-endpoint.json",
  "runtime-mcp.sock",
  "runtime-state.json",
  "runtime.log"
]);

const WORKSPACE_JSON_FILES = [
  "workbench-layout.json",
  "evidence-media-vacuum-v1.json",
  "evidence-media-retention-v1.json",
  "evidence-media-deletions-v1.json"
];

const SECRET_PATTERNS = [
  ["aws_access_key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["openai_api_key", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ["figma_pat", /\bfigd_[A-Za-z0-9_-]{20,}\b/g],
  ["github_token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  ["google_api_key", /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ["private_key", /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----\r?\n(?:[A-Za-z0-9+/=]{20,}\r?\n){2,}/g]
];

const args = parseArgs(process.argv.slice(2));
const pluginSource = requireDirectory(args.plugin, "--plugin");
const pluginVersion = readPluginVersion(pluginSource);
const output = requireOutput(args.output);
const packageName = path.basename(output);
const staging = `${output}.staging-${process.pid}`;
const workspaceSpecs = resolveWorkspaceSpecs(args);

if (fs.existsSync(output)) fail(`Output already exists: ${output}`);
if (fs.existsSync(staging)) fail(`Staging path already exists: ${staging}`);

let completed = false;
try {
  for (const workspace of workspaceSpecs) assertStopped(workspace.source);
  fs.mkdirSync(staging, { recursive: false });

  const pluginDestination = path.join(staging, "plugins", "ikran");
  const studyRuntime = copyCodexPlugin(pluginSource, pluginDestination, pluginVersion);

  const packagedWorkspaces = workspaceSpecs.map((workspace) =>
    packageWorkspace(
      workspace.source,
      path.join(staging, workspace.relativePath),
      workspace.id,
      workspace.relativePath
    )
  );

  writeJson(path.join(staging, ".agents", "plugins", "marketplace.json"), marketplaceManifest());

  const manifest = {
    schemaVersion: 1,
    package: packageName,
    host: "codex",
    plugin: {
      name: "ikran",
      version: pluginVersion,
      path: "plugins/ikran",
      marketplace: ".agents/plugins/marketplace.json",
      studyRuntime
    },
    figmaConnectionRequired: false,
    participantCheckpoint: "alignment-answering",
    workspaces: packagedWorkspaces
  };
  writeJson(path.join(staging, "STUDY-KIT-MANIFEST.json"), manifest);
  writeText(path.join(staging, "START-HERE.md"), startHere(packageName, packagedWorkspaces));

  const privacy = scanPackage(staging, {
    forbiddenLiterals: [
      ...workspaceSpecs.map((workspace) => workspace.source),
      pluginSource,
      os.homedir(),
      os.userInfo().username
    ]
  });
  writeJson(path.join(staging, "PRIVACY-REPORT.json"), privacy);

  const checksums = criticalChecksums(staging, manifest);
  writeText(
    path.join(staging, "CHECKSUMS.sha256"),
    checksums.map(({ digest, relativePath }) => `${digest}  ${relativePath}`).join("\n") + "\n"
  );

  fs.renameSync(staging, output);
  completed = true;
  process.stdout.write(`${JSON.stringify({ ok: true, output, manifest, privacy }, null, 2)}\n`);
} finally {
  if (!completed && fs.existsSync(staging)) {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value) fail("Expected --key value arguments");
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

function resolveWorkspaceSpecs(parsed) {
  if (parsed.kit) {
    if (parsed.kit1 || parsed.kit2) {
      fail("Use either --kit or --kit1/--kit2, not both modes");
    }
    const id = parsed["workspace-id"];
    if (!new Set(["kit-1", "kit-2"]).has(id)) {
      fail("Single-workspace mode requires --workspace-id kit-1 or kit-2");
    }
    return [{
      id,
      source: requireDirectory(parsed.kit, "--kit"),
      relativePath: "workspace"
    }];
  }
  return [
    {
      id: "kit-1",
      source: requireDirectory(parsed.kit1, "--kit1"),
      relativePath: path.join("workspaces", "kit-1")
    },
    {
      id: "kit-2",
      source: requireDirectory(parsed.kit2, "--kit2"),
      relativePath: path.join("workspaces", "kit-2")
    }
  ];
}

function requireDirectory(value, flag) {
  if (!value) fail(`Missing ${flag}`);
  const resolved = path.resolve(value);
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`${flag} must point to a directory: ${resolved}`);
  }
  return resolved;
}

function requireOutput(value) {
  if (!value) fail("Missing --output");
  const resolved = path.resolve(value);
  const parent = path.dirname(resolved);
  if (!fs.statSync(parent, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`Output parent must exist: ${parent}`);
  }
  return resolved;
}

function assertStopped(workspace) {
  const ikran = path.join(workspace, ".ikran");
  for (const filename of ["runtime-endpoint.json", "runtime-mcp.sock"]) {
    if (fs.existsSync(path.join(ikran, filename))) {
      fail(`Runtime is not stopped: ${path.join(ikran, filename)}`);
    }
  }
  if (!fs.existsSync(path.join(ikran, "ikran.db"))) {
    fail(`Missing Ikran database: ${workspace}`);
  }
}

function copyCodexPlugin(source, destination, version) {
  assertProdBuildMatchesSource({ appDir: source, prod: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
    filter(candidate) {
      const relative = path.relative(source, candidate);
      if (!relative) return true;
      const top = relative.split(path.sep)[0];
      if (new Set([".cursor-plugin", "plugin.json", "mcp.json", ".npmrc", "RELEASE-MANIFEST.json"]).has(top)) return false;
      if (relative === path.join(".next", "cache") || relative.startsWith(`${path.join(".next", "cache")}${path.sep}`)) return false;
      if (fs.lstatSync(candidate).isSymbolicLink() && !fs.existsSync(candidate)) return false;
      return true;
    }
  });

  const manifest = {
    name: "ikran",
    description: "Codex-only Ikran research workbench for the preloaded Study Kit.",
    version,
    author: { name: "Ikran", url: "https://github.com/Zby9999/ikran" },
    homepage: "https://github.com/Zby9999/ikran",
    repository: "https://github.com/Zby9999/ikran",
    license: "Apache-2.0",
    keywords: ["design-system", "mcp", "study-kit", "workbench"],
    skills: "./skills/",
    mcpServers: {
      ikran: {
        command: "node",
        args: ["./bin/ikran-mcp.mjs", "--prod"],
        cwd: "."
      }
    },
    interface: {
      displayName: "Ikran Study Kit",
      shortDescription: "Open a preloaded Ikran Alignment study workspace.",
      longDescription: "Runs the local Ikran Workbench and resumes the bundled evidence-grounded Alignment checkpoint without requiring a new Figma connection.",
      developerName: "Ikran",
      category: "Productivity",
      capabilities: ["Local MCP tools", "Design Intent Alignment", "Evidence-grounded Workbench"],
      defaultPrompt: "Open Ikran for this workspace and resume its existing Alignment. Do not request a Figma connection for the preloaded reference."
    }
  };
  writeJson(path.join(destination, ".codex-plugin", "plugin.json"), manifest);
  writeText(path.join(destination, "README.md"), pluginReadme());
  patchPortableRuntimeSocket(path.join(destination, "bin", "ikran-mcp.mjs"), "mcp");
  patchPortableRuntimeSocket(path.join(destination, "bin", "ikran-runtime.mjs"), "runtime");
  const studyRuntime = buildStudyRuntime({ sourceRoot: source, destinationRoot: destination });
  writeVersionStamp(destination);

  for (const relative of [
    path.join(".next", "required-server-files.json"),
    path.join(".next", "required-server-files.js")
  ]) {
    const file = path.join(destination, relative);
    if (!fs.existsSync(file)) fail(`Missing production build file: ${relative}`);
    const before = fs.readFileSync(file, "utf8");
    const after = before.split(source).join(".");
    if (after.includes(source)) fail(`Failed to sanitize build path: ${relative}`);
    fs.writeFileSync(file, after, "utf8");
  }
  return studyRuntime;
}

function readPluginVersion(source) {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
  const version = manifest?.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`Plugin package.json has an invalid version: ${String(version)}`);
  }
  return version;
}

function patchPortableRuntimeSocket(file, kind) {
  let source = fs.readFileSync(file, "utf8");
  if (kind === "mcp") {
    source = replaceExactlyOnce(
      source,
      'import { spawn } from "node:child_process";',
      'import { spawn } from "node:child_process";\nimport { createHash } from "node:crypto";',
      file
    );
    source = replaceExactlyOnce(
      source,
      'import { homedir } from "node:os";',
      'import { homedir, tmpdir } from "node:os";',
      file
    );
  } else {
    source = replaceExactlyOnce(
      source,
      'import "tsx";',
      'import "tsx";\nimport { createHash } from "node:crypto";',
      file
    );
    source = replaceExactlyOnce(
      source,
      'import { homedir } from "node:os";',
      'import { homedir, tmpdir } from "node:os";',
      file
    );
  }

  source = replaceExactlyOnce(
    source,
    'const socketPath = path.join(stateDir, "runtime-mcp.sock");',
    `const socketPath = resolveRuntimeSocketPath(stateDir);

function resolveRuntimeSocketPath(stateDirectory) {
  const workspaceSocket = path.join(stateDirectory, "runtime-mcp.sock");
  if (process.platform === "win32" || Buffer.byteLength(workspaceSocket) < 100) {
    return workspaceSocket;
  }
  const digest = createHash("sha256")
    .update(path.resolve(stateDirectory))
    .digest("hex")
    .slice(0, 24);
  const privateTempSocket = path.join(tmpdir(), \`ikran-\${digest}.sock\`);
  if (Buffer.byteLength(privateTempSocket) < 100) return privateTempSocket;
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  return \`/tmp/ikran-\${uid}-\${digest}.sock\`;
}`,
    file
  );
  fs.writeFileSync(file, source, "utf8");
}

function replaceExactlyOnce(source, before, after, file) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    fail(`Expected exactly one portable-socket patch target in ${file}: ${before}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function packageWorkspace(source, destination, label, relativePath) {
  const sourceIkran = path.join(source, ".ikran");
  const destinationIkran = path.join(destination, ".ikran");
  fs.mkdirSync(destinationIkran, { recursive: true });

  const sourceDb = path.join(sourceIkran, "ikran.db");
  const destinationDb = path.join(destinationIkran, "ikran.db");
  fs.copyFileSync(sourceDb, destinationDb);

  for (const filename of WORKSPACE_JSON_FILES) {
    const input = path.join(sourceIkran, filename);
    if (fs.existsSync(input)) fs.copyFileSync(input, path.join(destinationIkran, filename));
  }

  const artifacts = path.join(sourceIkran, "artifacts");
  if (!fs.statSync(artifacts, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`Missing artifacts directory: ${artifacts}`);
  }
  fs.cpSync(artifacts, path.join(destinationIkran, "artifacts"), {
    recursive: true,
    preserveTimestamps: true
  });

  sanitizeDatabase(destinationDb, source, label);
  writeText(path.join(destination, "README.md"), workspaceReadme());

  for (const name of EPHEMERAL_NAMES) {
    if (fs.existsSync(path.join(destinationIkran, name))) {
      fail(`Ephemeral Runtime file entered package: ${label}/${name}`);
    }
  }

  const state = inspectDatabase(destinationDb);
  if (state.stage !== "alignment-answering" || state.attemptStatus !== "answering") {
    fail(`${label} is not frozen at Alignment answering`);
  }
  if (state.designSystemEntries || state.sourceArtifacts || state.prototypeRuns || state.prototypeSurfaces) {
    fail(`${label} contains post-Alignment artifacts`);
  }
  if (state.questionCount !== 16 || state.finalAnswerCount !== 0) {
    fail(`${label} must contain 16 unanswered Question cards`);
  }

  const screenshot = path.join(destination, state.screenshotArtifactPath);
  if (!fs.statSync(screenshot, { throwIfNoEntry: false })?.isFile()) {
    fail(`${label} screenshot is missing: ${state.screenshotArtifactPath}`);
  }

  return {
    id: label,
    path: slash(relativePath),
    frame: {
      fileKey: state.fileKey,
      nodeId: state.nodeId,
      name: state.frameName
    },
    evidence: {
      screenshot: state.screenshotArtifactPath,
      positionalNodeCount: state.positionalNodeCount
    },
    alignment: {
      stage: state.stage,
      attemptStatus: state.attemptStatus,
      annotations: state.annotationCount,
      questions: state.questionCount,
      finalAnswers: state.finalAnswerCount
    }
  };
}

function sanitizeDatabase(databasePath, sourceWorkspace, label) {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    const immutableSnapshotTriggers = db.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'alignment_input_snapshots' ORDER BY name"
    ).all().filter((trigger) => trigger.sql);

    db.exec("BEGIN IMMEDIATE;");
    for (const trigger of immutableSnapshotTriggers) {
      db.exec(`DROP TRIGGER ${quoteIdentifier(String(trigger.name))}`);
    }
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all();
    for (const { name } of tables) {
      const table = String(name);
      const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
      for (const column of columns) {
        if (!String(column.type ?? "").toUpperCase().includes("TEXT")) continue;
        const columnName = String(column.name);
        const select = db.prepare(
          `SELECT rowid AS record_rowid, ${quoteIdentifier(columnName)} AS value FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(columnName)} IS NOT NULL`
        );
        const update = db.prepare(
          `UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier(columnName)} = ? WHERE rowid = ?`
        );
        for (const row of select.all()) {
          if (typeof row.value !== "string") continue;
          const sanitized = sanitizeText(row.value, sourceWorkspace, label);
          if (sanitized !== row.value) update.run(sanitized, row.record_rowid);
        }
      }
    }
    for (const trigger of immutableSnapshotTriggers) {
      db.exec(String(trigger.sql));
    }
    db.exec("COMMIT;");

    const restoredSnapshotTriggers = db.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'alignment_input_snapshots' ORDER BY name"
    ).all().filter((trigger) => trigger.sql);
    assert.deepEqual(
      restoredSnapshotTriggers,
      immutableSnapshotTriggers,
      `${label} immutable Alignment snapshot triggers were not restored exactly`
    );

    db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
    const integrity = db.prepare("PRAGMA integrity_check").get();
    if (Object.values(integrity ?? {})[0] !== "ok") fail(`${label} database integrity check failed`);
    if (db.prepare("PRAGMA foreign_key_check").all().length) {
      fail(`${label} database foreign-key check failed`);
    }
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

function sanitizeText(value, sourceWorkspace, label) {
  return value
    .split(sourceWorkspace).join(".")
    .split(os.homedir()).join("[LOCAL_HOME]")
    .replace(/&t=[^"'\\\s]+/g, "")
    .replace(/\"name\":\"ikran study kit [12]\"/g, `\"name\":\"${label}\"`);
}

function inspectDatabase(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const scalar = (sql) => Number(Object.values(db.prepare(sql).get() ?? { value: 0 })[0] ?? 0);
    const workflow = db.prepare(
      `SELECT project_workflow.stage,
              alignment_attempts.status AS attempt_status
       FROM project_workflow
       JOIN alignment_attempts ON alignment_attempts.id = project_workflow.current_alignment_attempt_id
       WHERE project_workflow.singleton = 1`
    ).get();
    const evidence = db.prepare(
      `SELECT seed_references.file_key,
              seed_references.node_id,
              figma_evidence_surfaces.frame_name,
              figma_evidence_surfaces.screenshot_artifact_path,
              json_array_length(figma_evidence_surfaces.positional_nodes_json) AS positional_node_count
       FROM seed_references
       JOIN figma_evidence_surfaces ON figma_evidence_surfaces.id = seed_references.current_surface_id
       LIMIT 1`
    ).get();
    if (!workflow || !evidence) fail(`Incomplete Ikran state: ${databasePath}`);
    return {
      stage: String(workflow.stage),
      attemptStatus: String(workflow.attempt_status),
      annotationCount: scalar("SELECT count(*) FROM agent_alignment_annotations WHERE alignment_attempt_id = (SELECT current_alignment_attempt_id FROM project_workflow WHERE singleton = 1)"),
      questionCount: scalar("SELECT count(*) FROM alignment_question_cards WHERE alignment_attempt_id = (SELECT current_alignment_attempt_id FROM project_workflow WHERE singleton = 1)"),
      finalAnswerCount: scalar("SELECT count(*) FROM alignment_question_cards WHERE alignment_attempt_id = (SELECT current_alignment_attempt_id FROM project_workflow WHERE singleton = 1) AND final_answer IS NOT NULL AND trim(final_answer) <> ''"),
      designSystemEntries: scalar("SELECT count(*) FROM design_system_entries"),
      sourceArtifacts: scalar("SELECT count(*) FROM source_artifacts"),
      prototypeRuns: scalar("SELECT count(*) FROM prototype_runs"),
      prototypeSurfaces: scalar("SELECT count(*) FROM prototype_surfaces"),
      fileKey: String(evidence.file_key),
      nodeId: String(evidence.node_id),
      frameName: String(evidence.frame_name),
      screenshotArtifactPath: String(evidence.screenshot_artifact_path),
      positionalNodeCount: Number(evidence.positional_node_count)
    };
  } finally {
    db.close();
  }
}

function marketplaceManifest() {
  return {
    name: "ikran-study-kit",
    interface: { displayName: "Ikran Study Kit" },
    plugins: [
      {
        name: "ikran",
        source: { source: "local", path: "./plugins/ikran" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity"
      }
    ]
  };
}

function scanPackage(root, { forbiddenLiterals }) {
  const forbiddenFiles = [];
  const localInformationHits = [];
  const secretHits = [];
  const figmaQueryTokenHits = [];
  let filesScanned = 0;
  let bytesScanned = 0;

  for (const file of walkFiles(root)) {
    filesScanned += 1;
    const relative = slash(path.relative(root, file));
    const base = path.basename(file);
    if (EPHEMERAL_NAMES.has(base) || relative.includes("/.cursor/") || relative.startsWith(".cursor/")) {
      forbiddenFiles.push(relative);
    }
    const content = fs.readFileSync(file);
    bytesScanned += content.length;
    for (const literal of forbiddenLiterals.filter(Boolean)) {
      if (content.includes(Buffer.from(literal))) {
        localInformationHits.push({ file: relative, category: "local_literal" });
      }
    }
    const text = content.toString("latin1");
    for (const [category, pattern] of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) secretHits.push({ file: relative, category });
    }
    if (
      (relative.startsWith("workspaces/") || relative.startsWith("workspace/")) &&
      /(?:\?|&)t=[A-Za-z0-9_-]{8,}/.test(text)
    ) {
      figmaQueryTokenHits.push({ file: relative, category: "figma_query_token" });
    }
  }

  const failures = [forbiddenFiles, localInformationHits, secretHits, figmaQueryTokenHits].flat();
  if (failures.length) {
    fail(`Privacy scan failed:\n${JSON.stringify(failures, null, 2)}`);
  }
  return {
    ok: true,
    filesScanned,
    bytesScanned,
    forbiddenRuntimeFiles: 0,
    localInformationHits: 0,
    credentialHits: 0,
    figmaQueryTokenHits: 0
  };
}

function criticalChecksums(root, manifest) {
  const relativePaths = [
    ".agents/plugins/marketplace.json",
    "STUDY-KIT-MANIFEST.json",
    "plugins/ikran/.codex-plugin/plugin.json",
    "plugins/ikran/bin/ikran-runtime.mjs",
    `plugins/ikran/${manifest.plugin.studyRuntime.bundle}`
  ];
  for (const workspace of manifest.workspaces) {
    relativePaths.push(`${workspace.path}/.ikran/ikran.db`);
    relativePaths.push(`${workspace.path}/${workspace.evidence.screenshot}`);
  }
  return relativePaths.sort().map((relativePath) => ({
    relativePath,
    digest: sha256(path.join(root, relativePath))
  }));
}

function startHere(packageName, workspaces) {
  const single = workspaces.length === 1;
  const title = single ? `Ikran Study Kit ${workspaces[0].id.slice(-1)} — Codex` : "Ikran Study Kit — Codex";
  const workspaceInstruction = single
    ? `3. Start a **new Codex task** from the package's only workspace: \`${workspaces[0].path}\`.`
    : `3. Start a **new Codex task** from exactly one assigned workspace:\n${workspaces.map((workspace) => `   - \`${workspace.path}\``).join("\n")}`;
  const setupAudience = single ? "Participant setup" : "Researcher setup";
  const workspaceDescription = single
    ? "one preloaded study workspace"
    : `${workspaces.length} preloaded, independent study workspaces`;
  return `# ${title}\n\nThis package contains one Codex plugin and ${workspaceDescription}.\n\n## ${setupAudience}\n\n1. Keep this extracted folder intact.\n2. Ask Codex to install the bundled plugin, or run:\n\n   \`\`\`bash\n   codex plugin marketplace add <PATH_TO_${packageName}>\n   codex plugin add ikran@ikran-study-kit\n   \`\`\`\n\n${workspaceInstruction}\n4. Ask: \`打开 Ikran，并继续当前 Alignment。\`\n\nThe workspace already contains its Figma reference, evidence screenshot, positional nodes, and unanswered Alignment cards. A Figma Connection is not required. Do not refresh or replace the reference during the study.\n\nThe workspace is frozen before Draft Design System generation.\n`;
}

function workspaceReadme() {
  return `# Ikran study workspace\n\nOpen this folder as the Codex workspace, then ask the Agent to open Ikran and continue the existing Alignment.\n\nThe Figma reference and evidence are already installed. Do not connect Figma, refresh the reference, or generate a Draft Design System before answering the study questions.\n`;
}

function pluginReadme() {
  return `# Ikran — Codex Study Kit build\n\nThis Codex-only plugin is bundled with a preloaded Ikran Study Kit. It contains the production Runtime, Workbench, MCP tools, and Ikran skills.\n\nInstall it through the Study Kit marketplace at .agents/plugins/marketplace.json. The bundled workspaces already contain their Figma reference evidence, so no Figma credential is required for the study flow.\n`;
}

function walkFiles(root) {
  const files = [];
  const visit = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
      else if (entry.isSymbolicLink()) {
        const target = fs.readlinkSync(full);
        const resolved = path.resolve(path.dirname(full), target);
        if (path.isAbsolute(target) || !resolved.startsWith(`${root}${path.sep}`)) {
          fail(`Symlink escapes package root: ${slash(path.relative(root, full))}`);
        }
      }
    }
  };
  visit(root);
  return files;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function slash(value) {
  return value.split(path.sep).join("/");
}

function fail(message) {
  throw new Error(message);
}
