import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import ts from "typescript";

import { closeProjectDb, openProjectDb, withProjectTransaction } from "./db";
import { declareComponentLiveHeroes } from "./design-system-live-hero";
import { logEvent } from "./events";
import {
  assertArtifactPathInProject,
  resolveProjectArtifactPath
} from "./evidence-package";
import { canonicalizeArtifactPath } from "./source-artifact";

// Next App Router treats every leading-underscore directory as private and
// excludes it from routing. Keep the Runtime namespace explicit but routable.
export const SHARED_COMPONENT_PREVIEW_ROUTE = "/ikran/component-preview";

export interface RegisterComponentPreviewInput {
  runId: string;
  surfaceId: string;
  entryId: string;
  modulePath: string;
  exportName: string;
  defaultArgs?: Record<string, unknown>;
  stateArgs?: Record<string, Record<string, unknown>>;
}

export interface ComponentPreviewRegistrationRecord {
  id: string;
  run_id: string;
  prototype_surface_id: string;
  entry_id: string;
  module_path: string;
  export_name: string;
  default_args: Record<string, unknown>;
  state_args: Record<string, Record<string, unknown>>;
  prototype_root: string;
  adapter_artifact_path: string;
  manifest_artifact_path: string;
  adapter_route: string;
  registration_digest: string;
}

export type RegisterComponentPreviewResult =
  | {
      ok: true;
      registration: ComponentPreviewRegistrationRecord;
      adapter: { created: boolean; reused: boolean };
      idempotent: boolean;
      event_id: string;
    }
  | {
      ok: false;
      reason:
        | "invalid_input"
        | "artifact_path_escape"
        | "module_not_declared"
        | "module_not_code_artifact"
        | "module_file_missing"
        | "export_not_found"
        | "entry_not_found"
        | "entry_not_component_spec"
        | "module_not_linked"
        | "run_not_found"
        | "surface_not_found"
        | "surface_run_mismatch"
        | "preview_unavailable"
        | "unsupported_preview_adapter"
        | "adapter_write_failed"
        | "live_hero_declaration_failed"
        | "db_error";
      details?: unknown;
    };

export type ValidateComponentPreviewDeclarationResult =
  | { ok: true }
  | Extract<RegisterComponentPreviewResult, { ok: false }>;

type DbRegistration = {
  id: string;
  run_id: string;
  prototype_surface_id: string;
  entry_row_id: string;
  entry_id: string;
  module_path: string;
  export_name: string;
  default_args_json: string;
  state_args_json: string;
  prototype_root: string;
  adapter_artifact_path: string;
  manifest_artifact_path: string;
  adapter_route: string;
  registration_digest: string;
};

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function hasModifier(
  node: ts.Node,
  kind: ts.SyntaxKind
): boolean {
  return Boolean(ts.getModifiers(node as ts.HasModifiers)?.some((m) => m.kind === kind));
}

function exportedNames(source: string, fileName: string): Set<string> {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isVariableStatement(statement)) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
        names.add("default");
      }
      if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
        if (statement.name) names.add(statement.name.text);
      } else {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
        }
      }
    }
    if (ts.isExportAssignment(statement)) names.add("default");
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          names.add(element.name.text);
        }
      }
    }
  }
  return names;
}

export const SUPPORTED_COMPONENT_PREVIEW_ADAPTERS = [
  "next-app-router",
  "vite-react"
] as const;

type PreviewAdapterId = (typeof SUPPORTED_COMPONENT_PREVIEW_ADAPTERS)[number];

type PreviewAdapterPaths = { adapter: string; manifest: string };

interface PreviewAdapter {
  id: PreviewAdapterId;
  paths: PreviewAdapterPaths;
  route(registrationId: string): string;
  adapterSource: string;
  manifestSource(rows: readonly DbRegistration[]): string;
}

type UnsupportedPreviewAdapterDetails = {
  detected: {
    framework: "next" | "vite" | "react" | "unknown";
    packageManagerMetadataFound: boolean;
    appRouterDirectoryFound: boolean;
    viteHtmlEntryFound: boolean;
  };
  supportedAdapters: readonly PreviewAdapterId[];
  versionChangesWillNotHelp: true;
  remediation: string;
};

function importPath(fromFile: string, modulePath: string): string {
  let relative = path.relative(path.dirname(fromFile), modulePath);
  relative = relative.replace(/\\/g, "/").replace(/\.(tsx?|jsx?)$/, "");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function componentImports(rows: readonly DbRegistration[]): string[] {
  return rows.map((row, index) => {
    const source = JSON.stringify(importPath(row.manifest_artifact_path, row.module_path));
    return row.export_name === "default"
      ? `import IkranComponent${index} from ${source};`
      : `import { ${row.export_name} as IkranComponent${index} } from ${source};`;
  });
}

function registryEntries(rows: readonly DbRegistration[]): string[] {
  return rows.map(
    (row, index) =>
      `  ${JSON.stringify(row.id)}: { Component: IkranComponent${index}, defaultArgs: ${row.default_args_json}, stateArgs: ${row.state_args_json} }`
  );
}

function nextManifestSource(rows: readonly DbRegistration[]): string {
  const imports = componentImports(rows);
  const entries = registryEntries(rows);
  return `"use client";\n\n${imports.join("\n")}\n\nexport const ikranComponentPreviewRegistry = {\n${entries.join(",\n")}\n} as const;\n`;
}

const NEXT_ADAPTER_SOURCE = `"use client";

import { createElement, useEffect, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ikranComponentPreviewRegistry } from "../registry";

export default function IkranComponentPreview() {
  const params = useParams<{ registrationId: string }>();
  const search = useSearchParams();
  const root = useRef<HTMLDivElement>(null);
  const registration = ikranComponentPreviewRegistry[params.registrationId as keyof typeof ikranComponentPreviewRegistry];
  const state = search.get("state") ?? "default";
  useEffect(() => {
    if (!root.current || !registration) return;
    const href = window.location.href;
    const report = () => {
      const rect = root.current!.getBoundingClientRect();
      window.parent.postMessage({
        type: "ikran:component-size", version: 2, href,
        x: rect.left, y: rect.top,
        width: Math.max(root.current!.scrollWidth, rect.width),
        height: Math.max(root.current!.scrollHeight, rect.height)
      }, "*");
    };
    const observer = new ResizeObserver(report);
    observer.observe(root.current);
    const frame = requestAnimationFrame(report);
    window.addEventListener("resize", report);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", report); };
  }, [registration, state]);
  if (!registration) return <div data-ikran-preview-error="registration-not-found" />;
  const stateArgs = registration.stateArgs[state as keyof typeof registration.stateArgs] ?? {};
  return <div ref={root} data-ikran-component-root style={{ display: "inline-block" }}>
    {createElement(registration.Component, { ...registration.defaultArgs, ...stateArgs })}
  </div>;
}
`;

const VITE_ADAPTER_SOURCE = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>html, body { margin: 0; overflow: hidden; } #ikran-root { display: inline-block; }</style>
  </head>
  <body>
    <div id="ikran-root"></div>
    <script type="module">
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { ikranComponentPreviewRegistry } from "/src/ikran/component-preview-registry.jsx";

      const registrationId = new URL(window.location.href).searchParams.get("registrationId");
      const state = new URL(window.location.href).searchParams.get("state") ?? "default";
      const registration = registrationId ? ikranComponentPreviewRegistry[registrationId] : null;
      const mount = document.getElementById("ikran-root");
      if (!registration || !mount) {
        document.body.innerHTML = '<div data-ikran-preview-error="registration-not-found"></div>';
      } else {
        mount.dataset.ikranComponentRoot = "";
        const stateArgs = registration.stateArgs[state] ?? {};
        createRoot(mount).render(React.createElement(registration.Component, {
          ...registration.defaultArgs,
          ...stateArgs
        }));
        const report = () => {
          const rect = mount.getBoundingClientRect();
          window.parent.postMessage({
            type: "ikran:component-size", version: 2, href: window.location.href,
            x: rect.left, y: rect.top,
            width: Math.max(mount.scrollWidth, rect.width),
            height: Math.max(mount.scrollHeight, rect.height)
          }, "*");
        };
        new ResizeObserver(report).observe(mount);
        requestAnimationFrame(report);
        window.addEventListener("resize", report);
      }
    </script>
  </body>
</html>
`;

function readPackageMetadata(
  projectPath: string,
  prototypeRoot: string
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(projectPath, prototypeRoot, "package.json"), "utf8")
    ) as unknown;
    return plainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function packageNames(metadata: Record<string, unknown> | null): Set<string> {
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies"]) {
    const value = metadata?.[field];
    if (!plainObject(value)) continue;
    for (const name of Object.keys(value)) names.add(name);
  }
  return names;
}

function directViteEntryCssImports(
  projectPath: string,
  prototypeRoot: string,
  manifestPath: string
): string[] {
  try {
    const html = readFileSync(
      path.join(projectPath, prototypeRoot, "index.html"),
      "utf8"
    );
    const moduleScript = [...html.matchAll(/<script\b[^>]*>/gi)]
      .map((match) => match[0])
      .find((tag) => /\btype=["']module["']/i.test(tag));
    const entryMatch = moduleScript?.match(/\bsrc=["']([^"']+)["']/i);
    if (!entryMatch) return [];
    const entryPath = entryMatch[1]!.split(/[?#]/, 1)[0]!;
    if (/^(?:https?:)?\/\//i.test(entryPath) || entryPath.includes("..")) return [];
    const entryRelative = path.join(prototypeRoot, entryPath.replace(/^\//, ""));
    const entryAbsolute = path.join(projectPath, entryRelative);
    const source = readFileSync(entryAbsolute, "utf8");
    const cssImports = new Set<string>();
    const importPattern = /(?:import\s+(?:[^"']+?\s+from\s+)?|import\s*)["']([^"']+\.css(?:[?#][^"']*)?)["']/g;
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1]!.split(/[?#]/, 1)[0]!;
      if (!specifier.startsWith(".")) continue;
      const absolute = path.resolve(path.dirname(entryAbsolute), specifier);
      const rootAbsolute = path.resolve(projectPath, prototypeRoot);
      if (
        (absolute === rootAbsolute || absolute.startsWith(`${rootAbsolute}${path.sep}`)) &&
        existsSync(absolute)
      ) {
        cssImports.add(importPath(manifestPath, path.relative(projectPath, absolute)));
      }
    }
    return [...cssImports].sort();
  } catch {
    return [];
  }
}

function resolvePreviewAdapter(
  projectPath: string,
  prototypeRoot: string
): { ok: true; adapter: PreviewAdapter } | { ok: false; details: UnsupportedPreviewAdapterDetails } {
  const metadata = readPackageMetadata(projectPath, prototypeRoot);
  const packages = packageNames(metadata);
  const appRoot = ["app", "src/app"].find((candidate) =>
    existsSync(path.join(projectPath, prototypeRoot, candidate))
  );
  const viteHtmlEntryFound = existsSync(
    path.join(projectPath, prototypeRoot, "index.html")
  );
  if (appRoot && packages.has("next")) {
    const base = path.join(prototypeRoot, appRoot, "ikran", "component-preview");
    const paths = {
      adapter: path.join(base, "[registrationId]", "page.tsx"),
      manifest: path.join(base, "registry.tsx")
    };
    return {
      ok: true,
      adapter: {
        id: "next-app-router",
        paths,
        route: (registrationId) => `${SHARED_COMPONENT_PREVIEW_ROUTE}/${registrationId}`,
        adapterSource: NEXT_ADAPTER_SOURCE,
        manifestSource: nextManifestSource
      }
    };
  }
  if (
    viteHtmlEntryFound &&
    packages.has("vite") &&
    packages.has("react") &&
    packages.has("react-dom")
  ) {
    const paths = {
      adapter: path.join(prototypeRoot, "ikran-component-preview.html"),
      manifest: path.join(prototypeRoot, "src", "ikran", "component-preview-registry.jsx")
    };
    return {
      ok: true,
      adapter: {
        id: "vite-react",
        paths,
        route: (registrationId) =>
          `/ikran-component-preview.html?registrationId=${encodeURIComponent(registrationId)}`,
        adapterSource: VITE_ADAPTER_SOURCE,
        manifestSource: (rows) => {
          const styles = directViteEntryCssImports(
            projectPath,
            prototypeRoot,
            paths.manifest
          ).map((source) => `import ${JSON.stringify(source)};`);
          const imports = componentImports(rows);
          const entries = registryEntries(rows);
          return `${[...styles, ...imports].join("\n")}\n\nexport const ikranComponentPreviewRegistry = {\n${entries.join(",\n")}\n};\n`;
        }
      }
    };
  }
  const framework = packages.has("next")
    ? "next"
    : packages.has("vite")
      ? "vite"
      : packages.has("react")
        ? "react"
        : "unknown";
  return {
    ok: false,
    details: {
      detected: {
        framework,
        packageManagerMetadataFound: metadata !== null,
        appRouterDirectoryFound: appRoot !== undefined,
        viteHtmlEntryFound
      },
      supportedAdapters: SUPPORTED_COMPONENT_PREVIEW_ADAPTERS,
      versionChangesWillNotHelp: true,
      remediation:
        "Use a Next App Router prototype, or a Vite React prototype with package.json (vite/react/react-dom) and index.html. Do not change package versions to select an adapter."
    }
  };
}

function runtimeArtifactOnDb(
  db: ReturnType<typeof openProjectDb>,
  artifactPath: string,
  now: string
): void {
  const id = `runtime-preview:${digest(artifactPath).slice(0, 24)}`;
  db.prepare(
    `INSERT INTO source_artifacts
     (id, path, artifact_type, semantic_purpose, related_record_ids_json,
      readiness, declaration_version, status, created_at, updated_at)
     VALUES (?, ?, 'prototype', 'Ikran shared component preview adapter',
             '[]', 'ready', 1, 'ingested', ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       semantic_purpose = excluded.semantic_purpose,
       readiness = 'ready', status = 'ingested',
       declaration_version = source_artifacts.declaration_version + 1,
       updated_at = excluded.updated_at`
  ).run(id, artifactPath, now, now);
}

function publicRecord(row: DbRegistration): ComponentPreviewRegistrationRecord {
  return {
    id: row.id,
    run_id: row.run_id,
    prototype_surface_id: row.prototype_surface_id,
    entry_id: row.entry_id,
    module_path: row.module_path,
    export_name: row.export_name,
    default_args: JSON.parse(row.default_args_json) as Record<string, unknown>,
    state_args: JSON.parse(row.state_args_json) as Record<string, Record<string, unknown>>,
    prototype_root: row.prototype_root,
    adapter_artifact_path: row.adapter_artifact_path,
    manifest_artifact_path: row.manifest_artifact_path,
    adapter_route: row.adapter_route,
    registration_digest: row.registration_digest
  };
}

/**
 * Read-only fail-closed validation used before the ordinary artifact command
 * mutates source-artifact, component-spec, registration, or adapter state.
 * The declaration itself is allowed to be absent from source_artifacts and
 * codeLinks at this point because those are the two writes the command owns.
 */
export function validateComponentPreviewDeclaration(
  projectPath: string,
  input: RegisterComponentPreviewInput
): ValidateComponentPreviewDeclarationResult {
  const runId = nonEmpty(input.runId);
  const surfaceId = nonEmpty(input.surfaceId);
  const entryId = nonEmpty(input.entryId);
  const exportName = nonEmpty(input.exportName);
  if (
    !runId || !surfaceId || !entryId ||
    !(exportName === "default" || /^[A-Za-z_$][\w$]*$/.test(exportName)) ||
    (input.defaultArgs !== undefined && !plainObject(input.defaultArgs)) ||
    (input.stateArgs !== undefined && !plainObject(input.stateArgs))
  ) return { ok: false, reason: "invalid_input" };
  if (assertArtifactPathInProject(projectPath, input.modulePath) !== null) {
    return { ok: false, reason: "artifact_path_escape" };
  }
  const modulePath = canonicalizeArtifactPath(projectPath, input.modulePath);
  const moduleAbsolute = resolveProjectArtifactPath(projectPath, input.modulePath);
  if (!modulePath || !moduleAbsolute) {
    return { ok: false, reason: "artifact_path_escape" };
  }
  const db = openProjectDb(projectPath);
  let prototypeRoot = "";
  try {
    const run = db.prepare(
      `SELECT id, prototype_root FROM prototype_runs WHERE run_id = ?`
    ).get(runId) as { id: string; prototype_root: string } | undefined;
    if (!run) return { ok: false, reason: "run_not_found" };
    prototypeRoot = run.prototype_root;
    const surface = db.prepare(
      `SELECT prototype_run_id, readiness, stale FROM prototype_surfaces WHERE id = ?`
    ).get(surfaceId) as
      | { prototype_run_id: string; readiness: string; stale: number }
      | undefined;
    if (!surface) return { ok: false, reason: "surface_not_found" };
    if (surface.prototype_run_id !== run.id) {
      return { ok: false, reason: "surface_run_mismatch" };
    }
    const existingRegistration = db.prepare(
      `SELECT 1 FROM component_preview_registrations
       WHERE run_id = ? AND entry_id = ? AND prototype_surface_id = ?`
    ).get(runId, entryId, surfaceId);
    const existingException = db.prepare(
      `SELECT 1 FROM component_preview_exceptions
       WHERE run_id = ? AND entry_id = ? AND module_path = ?
         AND status = 'pending'
         AND json_extract(packet_json, '$.provenance.surface_id') = ?`
    ).get(runId, entryId, modulePath, surfaceId);
    if (
      surface.readiness !== "ready" ||
      (surface.stale === 1 && !existingRegistration && !existingException)
    ) {
      return { ok: false, reason: "preview_unavailable" };
    }
    const entry = db.prepare(
      `SELECT file_kind FROM design_system_entries
       WHERE id = ? OR entry_id = ? LIMIT 1`
    ).get(entryId, entryId) as { file_kind: string } | undefined;
    if (!entry) return { ok: false, reason: "entry_not_found" };
    if (entry.file_kind !== "component-spec") {
      return { ok: false, reason: "entry_not_component_spec" };
    }
  } catch {
    return { ok: false, reason: "db_error" };
  } finally {
    closeProjectDb(db);
  }
  if (!existsSync(moduleAbsolute)) {
    return { ok: false, reason: "module_file_missing" };
  }
  let moduleSource: string;
  try {
    moduleSource = readFileSync(moduleAbsolute, "utf8");
  } catch {
    return { ok: false, reason: "module_file_missing" };
  }
  if (!exportedNames(moduleSource, moduleAbsolute).has(exportName)) {
    return { ok: false, reason: "export_not_found" };
  }
  if (
    modulePath !== prototypeRoot &&
    !modulePath.startsWith(`${prototypeRoot}${path.sep}`)
  ) return { ok: false, reason: "artifact_path_escape" };
  const adapter = resolvePreviewAdapter(projectPath, prototypeRoot);
  if (!adapter.ok) {
    return {
      ok: false,
      reason: "unsupported_preview_adapter",
      details: adapter.details
    };
  }
  return { ok: true };
}

export function registerComponentPreview(
  projectPath: string,
  input: RegisterComponentPreviewInput
): RegisterComponentPreviewResult {
  const runId = nonEmpty(input.runId);
  const surfaceId = nonEmpty(input.surfaceId);
  const entryId = nonEmpty(input.entryId);
  const exportName = nonEmpty(input.exportName);
  if (
    !runId || !surfaceId || !entryId ||
    !(exportName === "default" || /^[A-Za-z_$][\w$]*$/.test(exportName)) ||
    (input.defaultArgs !== undefined && !plainObject(input.defaultArgs)) ||
    (input.stateArgs !== undefined && !plainObject(input.stateArgs))
  ) {
    return { ok: false, reason: "invalid_input" };
  }
  if (assertArtifactPathInProject(projectPath, input.modulePath) !== null) {
    return { ok: false, reason: "artifact_path_escape" };
  }
  const modulePath = canonicalizeArtifactPath(projectPath, input.modulePath);
  const moduleAbsolute = resolveProjectArtifactPath(projectPath, input.modulePath);
  if (!modulePath || !moduleAbsolute) {
    return { ok: false, reason: "artifact_path_escape" };
  }
  let db;
  try {
    db = openProjectDb(projectPath);
  } catch {
    return { ok: false, reason: "db_error" };
  }
  let run: { id: string; prototype_root: string } | undefined;
  let surface: { id: string; prototype_run_id: string; readiness: string; stale: number } | undefined;
  let entry: { id: string; entry_id: string; file_kind: string; value_json: string } | undefined;
  try {
    run = db.prepare(
      `SELECT id, prototype_root FROM prototype_runs WHERE run_id = ?`
    ).get(runId) as typeof run;
    if (!run) return { ok: false, reason: "run_not_found" };
    surface = db.prepare(
      `SELECT id, prototype_run_id, readiness, stale FROM prototype_surfaces WHERE id = ?`
    ).get(surfaceId) as typeof surface;
    if (!surface) return { ok: false, reason: "surface_not_found" };
    if (surface.prototype_run_id !== run.id) {
      return { ok: false, reason: "surface_run_mismatch" };
    }
    if (surface.readiness !== "ready" || surface.stale === 1) {
      return { ok: false, reason: "preview_unavailable" };
    }
    entry = db.prepare(
      `SELECT id, entry_id, file_kind, value_json FROM design_system_entries
       WHERE id = ? OR entry_id = ? ORDER BY CASE WHEN entry_id = ? THEN 0 ELSE 1 END LIMIT 1`
    ).get(entryId, entryId, entryId) as typeof entry;
    if (!entry) return { ok: false, reason: "entry_not_found" };
    if (entry.file_kind !== "component-spec") {
      return { ok: false, reason: "entry_not_component_spec" };
    }
    const artifact = db.prepare(
      `SELECT artifact_type FROM source_artifacts
       WHERE path = ? AND status IN ('declared', 'ingested')`
    ).get(modulePath) as { artifact_type: string } | undefined;
    if (!artifact) return { ok: false, reason: "module_not_declared" };
    if (artifact.artifact_type !== "code" && artifact.artifact_type !== "prototype") {
      return { ok: false, reason: "module_not_code_artifact" };
    }
  } finally {
    closeProjectDb(db);
  }
  if (!existsSync(moduleAbsolute)) {
    return { ok: false, reason: "module_file_missing" };
  }
  let moduleSource: string;
  try {
    moduleSource = readFileSync(moduleAbsolute, "utf8");
  } catch {
    return { ok: false, reason: "module_file_missing" };
  }
  if (!exportedNames(moduleSource, moduleAbsolute).has(exportName)) {
    return { ok: false, reason: "export_not_found" };
  }
  const value = JSON.parse(entry!.value_json) as Record<string, unknown>;
  const links = Array.isArray(value.codeLinks) ? value.codeLinks : [];
  if (!links.includes(modulePath)) {
    return { ok: false, reason: "module_not_linked" };
  }
  const prototypeRoot = run!.prototype_root;
  if (
    modulePath !== prototypeRoot &&
    !modulePath.startsWith(`${prototypeRoot}${path.sep}`)
  ) {
    return { ok: false, reason: "artifact_path_escape" };
  }
  const resolvedAdapter = resolvePreviewAdapter(projectPath, prototypeRoot);
  if (!resolvedAdapter.ok) {
    return {
      ok: false,
      reason: "unsupported_preview_adapter",
      details: resolvedAdapter.details
    };
  }
  const previewAdapter = resolvedAdapter.adapter;
  const paths = previewAdapter.paths;
  const id = `preview-${digest({ runId, entryId: entry!.entry_id }).slice(0, 20)}`;
  const defaultArgs = input.defaultArgs ?? {};
  const stateArgs = input.stateArgs ?? {};
  const registrationDigest = digest({ modulePath, exportName, defaultArgs, stateArgs });
  const row: DbRegistration = {
    id,
    run_id: runId,
    prototype_surface_id: surfaceId,
    entry_row_id: entry!.id,
    entry_id: entry!.entry_id,
    module_path: modulePath,
    export_name: exportName,
    default_args_json: stable(defaultArgs),
    state_args_json: stable(stateArgs),
    prototype_root: prototypeRoot,
    adapter_artifact_path: paths.adapter,
    manifest_artifact_path: paths.manifest,
    adapter_route: previewAdapter.route(id),
    registration_digest: registrationDigest
  };
  const idempotentDb = openProjectDb(projectPath);
  try {
    const existing = idempotentDb.prepare(
      `SELECT id, run_id, prototype_surface_id, entry_row_id, entry_id,
              module_path, export_name, default_args_json, state_args_json,
              prototype_root, adapter_artifact_path, manifest_artifact_path,
              adapter_route, registration_digest
       FROM component_preview_registrations
       WHERE run_id = ? AND entry_id = ?`
    ).get(runId, entry!.entry_id) as DbRegistration | undefined;
    const liveHero = (value.liveHero ?? null) as
      | { surfaceId?: unknown; harnessPath?: unknown; harnessArtifactPath?: unknown }
      | null;
    if (
      existing &&
      existing.registration_digest === registrationDigest &&
      existing.prototype_surface_id === surfaceId &&
      existing.module_path === modulePath &&
      existing.export_name === exportName &&
      liveHero?.surfaceId === surfaceId &&
      liveHero.harnessPath === row.adapter_route &&
      liveHero.harnessArtifactPath === paths.adapter &&
      existsSync(path.join(projectPath, paths.adapter)) &&
      existsSync(path.join(projectPath, paths.manifest))
    ) {
      const event = idempotentDb.prepare(
        `SELECT event_id FROM events
         WHERE type = 'component_preview_registered'
           AND json_extract(payload, '$.registration_id') = ?
         ORDER BY id DESC LIMIT 1`
      ).get(existing.id) as { event_id: string } | undefined;
      return {
        ok: true,
        registration: publicRecord(existing),
        adapter: { created: false, reused: true },
        idempotent: true,
        event_id: event?.event_id ?? ""
      };
    }
  } finally {
    closeProjectDb(idempotentDb);
  }
  const existingAdapter = existsSync(path.join(projectPath, paths.adapter));
  let priorRows: DbRegistration[] = [];
  try {
    const readDb = openProjectDb(projectPath);
    try {
      priorRows = readDb.prepare(
        `SELECT id, run_id, prototype_surface_id, entry_row_id, entry_id,
                module_path, export_name, default_args_json, state_args_json,
                prototype_root, adapter_artifact_path, manifest_artifact_path,
                adapter_route, registration_digest
         FROM component_preview_registrations
         WHERE prototype_root = ? AND id <> ? ORDER BY entry_id`
      ).all(prototypeRoot, id) as DbRegistration[];
    } finally {
      closeProjectDb(readDb);
    }
    const allRows = [...priorRows, row].sort((a, b) => a.entry_id.localeCompare(b.entry_id));
    const adapterAbsolute = path.join(projectPath, paths.adapter);
    const manifestAbsolute = path.join(projectPath, paths.manifest);
    mkdirSync(path.dirname(adapterAbsolute), { recursive: true });
    mkdirSync(path.dirname(manifestAbsolute), { recursive: true });
    writeFileSync(adapterAbsolute, previewAdapter.adapterSource, "utf8");
    writeFileSync(manifestAbsolute, previewAdapter.manifestSource(allRows), "utf8");
    const now = new Date().toISOString();
    withProjectTransaction(projectPath, (writeDb) => {
      runtimeArtifactOnDb(writeDb, paths.adapter, now);
      runtimeArtifactOnDb(writeDb, paths.manifest, now);
      writeDb.prepare(
        `INSERT INTO component_preview_registrations
         (id, run_id, prototype_surface_id, entry_row_id, entry_id, module_path,
          export_name, default_args_json, state_args_json, prototype_root,
          adapter_artifact_path, manifest_artifact_path, adapter_route,
          registration_digest, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, entry_id) DO UPDATE SET
           prototype_surface_id = excluded.prototype_surface_id,
           entry_row_id = excluded.entry_row_id,
           module_path = excluded.module_path,
           export_name = excluded.export_name,
           default_args_json = excluded.default_args_json,
           state_args_json = excluded.state_args_json,
           prototype_root = excluded.prototype_root,
           adapter_artifact_path = excluded.adapter_artifact_path,
           manifest_artifact_path = excluded.manifest_artifact_path,
           adapter_route = excluded.adapter_route,
           registration_digest = excluded.registration_digest,
           availability_status = CASE
             WHEN component_preview_registrations.availability_status = 'available'
               THEN 'available'
             ELSE 'registered'
           END,
           verification_status = 'unverified',
           verification_identity = NULL,
           updated_at = excluded.updated_at`
      ).run(
        row.id, row.run_id, row.prototype_surface_id, row.entry_row_id,
        row.entry_id, row.module_path, row.export_name, row.default_args_json,
        row.state_args_json, row.prototype_root, row.adapter_artifact_path,
        row.manifest_artifact_path, row.adapter_route,
        row.registration_digest, now, now
      );
    });
  } catch (error) {
    return { ok: false, reason: "adapter_write_failed", details: String(error) };
  }
  const declared = declareComponentLiveHeroes(projectPath, [
    {
      entryId: entry!.entry_id,
      surfaceId,
      harnessPath: row.adapter_route,
      harnessArtifactPath: paths.adapter
    }
  ]);
  if (!declared.ok) {
    return {
      ok: false,
      reason: "live_hero_declaration_failed",
      details: { reason: declared.reason, details: declared.details }
    };
  }
  const event = logEvent(projectPath, "component_preview_registered", {
    registration_id: id,
    run_id: runId,
    entry_id: entry!.entry_id,
    module_path: modulePath,
    export_name: exportName,
    registration_digest: registrationDigest,
    adapter_id: previewAdapter.id,
    adapter_route: row.adapter_route
  });
  return {
    ok: true,
    registration: publicRecord(row),
    adapter: { created: !existingAdapter, reused: existingAdapter },
    idempotent: false,
    event_id: event.event_id
  };
}
