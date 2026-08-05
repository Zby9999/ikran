// Ikran Issue 08 / 09 / 09A — `record_artifact_written` MCP boundary.
//
// Coverage:
// - listTools exposes record_artifact_written;
// - happy path: a written file declared through MCP enters the artifact index
//   and the event log (source_artifact_declared);
// - design-system declaration through MCP: schema-valid token.json linked to a
//   seeded answered card is validated, ingested into design_system_entries and
//   regenerates the derived export;
// - failure paths: unknown artifact type, out-of-scope path, invalid JSON,
//   alias cycle (schema-level), missing / unresolvable answered-card links,
//   never-written file guard — structured { ok:false, error } plus an
//   invalid_artifact event each, and NO artifact-index row;
// - ingest-time cross-validation: a "formalized" entry backed only by an
//   agent-accepted card is hard-rejected with
//   formalized_requires_designer_edited_link — no index row, no entries.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { expect, test } from "./fixtures";
import {
  killRecordedRuntime,
  spawnMcpClient,
  structuredContent
} from "./helpers/mcp";
import { stageAlignmentAnswering } from "./helpers/alignment";
import { openIkranDb } from "./helpers/db";
import { registerSeedReference } from "../lib/runtime/seed-reference";
import { recordEvidencePackage } from "../lib/runtime/evidence-package";
import { setDesignLanguageDescription } from "../lib/runtime/project-readiness";
import { listDeclaredArtifacts } from "../lib/runtime/source-artifact";
import { getDesignSystemView } from "../lib/runtime/design-system-view";

function readEventLines(
  dir: string
): Array<{ type: string; payload?: Record<string, unknown> }> {
  const db = openIkranDb(path.join(dir, ".ikran", "ikran.db"));
  try {
    return (
      db
        .prepare("SELECT type, payload FROM events ORDER BY id ASC")
        .all() as Array<{ type: string; payload: string }>
    ).map((r) => ({
      type: r.type,
      payload: JSON.parse(r.payload) as Record<string, unknown>
    }));
  } finally {
    db.close();
  }
}

test("record_artifact_written is discoverable and declares a written file", async () => {
  test.setTimeout(120_000);
  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-artifact-mcp-"));
  const projectDir = mkdtempSync(path.join(tmpdir(), "ikran-artifact-project-"));
  let client: Client | null = null;
  try {
    const handle = await spawnMcpClient(stateDir);
    client = handle.client;
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("record_artifact_written");
    expect(names).toContain("propose_rule_update");

    const opened = structuredContent(await client.callTool({
      name: "create_or_open_project",
      arguments: { path: projectDir }
    }));
    expect(opened.ok).toBe(true);

    const prototypePath = path.join(projectDir, "prototype", "index.html");
    mkdirSync(path.dirname(prototypePath), { recursive: true });
    writeFileSync(prototypePath, "<!doctype html><title>Prototype</title>\n", "utf-8");

    const declared = structuredContent(await client.callTool({
      name: "record_artifact_written",
      arguments: {
        path: "prototype/index.html",
        artifactType: "prototype",
        semanticPurpose: "First clickable prototype",
        relatedRecordIds: [],
        readiness: "opens in a browser"
      }
    }));
    expect(declared).toMatchObject({
      ok: true,
      record: {
        path: "prototype/index.html",
        artifact_type: "prototype",
        semantic_purpose: "First clickable prototype",
        declaration_version: 1,
        // Code-class artifacts are never ingested — only declared.
        status: "declared"
      }
    });
    expect(typeof declared.event_id).toBe("string");

    const events = readEventLines(projectDir);
    const declaredEvent = events.find(
      (event) => event.type === "source_artifact_declared"
    );
    expect(declaredEvent?.payload).toMatchObject({
      path: "prototype/index.html",
      artifact_type: "prototype"
    });
    expect(events.some((event) => event.type === "invalid_artifact")).toBe(false);

    const index = listDeclaredArtifacts(projectDir);
    expect(index.map((row) => row.path)).toEqual(["prototype/index.html"]);
  } finally {
    try {
      await client?.close();
    } catch {
      // ignore cleanup failure
    }
    killRecordedRuntime(stateDir);
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("design-system token.json declaration links an answered card and ingests", async () => {
  test.setTimeout(180_000);
  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-artifact-ds-mcp-"));
  const projectDir = mkdtempSync(path.join(tmpdir(), "ikran-artifact-ds-project-"));
  let client: Client | null = null;
  try {
    const handle = await spawnMcpClient(stateDir);
    client = handle.client;
    const opened = structuredContent(await client.callTool({
      name: "create_or_open_project",
      arguments: { path: projectDir }
    }));
    expect(opened.ok).toBe(true);
    const token = String(opened.session);
    const workbenchUrl = String(opened.workbench_url);

    // Minimal alignment staging: one answered question card to link against
    // (the finalize gate requires all six sections annotated + 2 proposed
    // cards each — stageAlignmentAnswering drives that via the real tools).
    expect(
      setDesignLanguageDescription(projectDir, "A calm, precise product language").ok
    ).toBe(true);
    const seed = registerSeedReference(projectDir, {
      figmaSeedReference: "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2",
      originalDesignIntent: "Artifact MCP fixture"
    });
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    const evidence = recordEvidencePackage(projectDir, {
      seedReferenceId: seed.record.id,
      frame: { nodeId: "1:2", name: "Checkout" },
      evidenceViews: { rawData: "available", screenshot: "missing" }
    });
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) return;

    const preparedResponse = await fetch(
      new URL("/api/design-intent-alignment", workbenchUrl),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-ikran-session": token
        },
        body: JSON.stringify({ action: "prepare" })
      }
    );
    expect(preparedResponse.status).toBe(200);

    const staged = await stageAlignmentAnswering(client, {
      seedReferenceId: seed.record.id,
      evidenceId: evidence.record.id,
      keyPrefix: "artifact-mcp"
    });
    const stagedCard = staged.cards["design-principle"][0];
    expect(structuredContent(await client.callTool({
      name: "record_designer_answer",
      arguments: { questionCardId: stagedCard.id, finalAnswer: stagedCard.answer }
    }))).toMatchObject({
      ok: true,
      record: { status: "answered" }
    });
    const cardId = stagedCard.id;

    // A schema-valid token.json: one candidate linked to the answered card,
    // one pure alias referencing it, and an empty component layer.
    const tokenPath = path.join(projectDir, "design-system", "token.json");
    mkdirSync(path.dirname(tokenPath), { recursive: true });
    writeFileSync(
      tokenPath,
      `${JSON.stringify({
        primitive: {
          "color.ink": {
            kind: "token",
            domain: "color",
            value: "#101418",
            status: "candidate",
            links: [cardId]
          }
        },
        semantic: {
          "color.text-primary": {
            kind: "token",
            domain: "color",
            value: {
              alias: "primitive.color.ink",
              usage: "Default text color"
            },
            status: "candidate",
            links: [cardId]
          }
        },
        component: {}
      }, null, 2)}\n`,
      "utf-8"
    );

    const declared = structuredContent(await client.callTool({
      name: "record_artifact_written",
      arguments: {
        path: "design-system/token.json",
        artifactType: "token.json",
        semanticPurpose: "Token source for the draft design system",
        relatedRecordIds: [cardId]
      }
    }));
    expect(declared).toMatchObject({
      ok: true,
      record: {
        path: "design-system/token.json",
        artifact_type: "token.json",
        // A design-system declaration that passed the ingest gate lands in
        // design_system_entries inside the same transaction.
        status: "ingested"
      }
    });

    const eventTypes = readEventLines(projectDir).map((event) => event.type);
    expect(eventTypes).toContain("source_artifact_declared");
    expect(eventTypes).toContain("draft_design_system_generated");
    expect(eventTypes).toContain("design_system_view_generated");

    // The DB view joins the evidence chain in real time (09A decision 6).
    const view = getDesignSystemView(projectDir);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    const primitive = view.view.tokens.primitive.find(
      (entry) => entry.entry_id === "primitive.color.ink"
    );
    expect(primitive).toMatchObject({ status: "candidate", meaning: "" });
    expect(primitive?.evidence.question_cards.map((cardEntry) => cardEntry.id))
      .toEqual([cardId]);
    const alias = view.view.tokens.semantic.find(
      (entry) => entry.entry_id === "semantic.color.text-primary"
    );
    expect(alias?.alias).toBe("primitive.color.ink");

    // Derived export regenerated from the DB after the ingest.
    const exportPath = path.join(
      projectDir,
      ".ikran",
      "artifacts",
      "design-system-view.json"
    );
    expect(existsSync(exportPath)).toBe(true);
    expect(readFileSync(exportPath, "utf-8")).toContain("primitive.color.ink");
  } finally {
    try {
      await client?.close();
    } catch {
      // ignore cleanup failure
    }
    killRecordedRuntime(stateDir);
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("invalid declarations return typed errors, log invalid_artifact and index nothing", async () => {
  test.setTimeout(120_000);
  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-artifact-bad-mcp-"));
  const projectDir = mkdtempSync(path.join(tmpdir(), "ikran-artifact-bad-project-"));
  let client: Client | null = null;
  try {
    const handle = await spawnMcpClient(stateDir);
    client = handle.client;
    const opened = structuredContent(await client.callTool({
      name: "create_or_open_project",
      arguments: { path: projectDir }
    }));
    expect(opened.ok).toBe(true);

    const declare = (arguments_: Record<string, unknown>) =>
      client!.callTool({ name: "record_artifact_written", arguments: arguments_ });

    // Unknown registry type — rejected at declaration validation.
    expect(structuredContent(await declare({
      path: "notes.txt",
      artifactType: "not-a-real-type",
      semanticPurpose: "Unknown type probe"
    }))).toMatchObject({ ok: false, error: "unknown_artifact_type" });

    // Out-of-scope path — fail-closed before any file I/O.
    expect(structuredContent(await declare({
      path: "../outside-the-project.txt",
      artifactType: "code",
      semanticPurpose: "Escape probe"
    }))).toMatchObject({ ok: false, error: "artifact_path_escape" });

    // Invalid JSON for a design-system type — deep file check rejects it.
    const tokenPath = path.join(projectDir, "design-system", "token.json");
    mkdirSync(path.dirname(tokenPath), { recursive: true });
    writeFileSync(tokenPath, "{ not json", "utf-8");
    expect(structuredContent(await declare({
      path: "design-system/token.json",
      artifactType: "token.json",
      semanticPurpose: "Broken JSON probe",
      relatedRecordIds: ["any-card"]
    }))).toMatchObject({ ok: false, error: "invalid_design_system_json" });

    // Alias cycle inside the semantic layer — the deep schema check rejects
    // it before any link resolution (two semantic tokens aliasing each other).
    writeFileSync(
      tokenPath,
      `${JSON.stringify({
        primitive: {},
        semantic: {
          "color.a": {
            kind: "token",
            domain: "color",
            value: { alias: "semantic.color.b", usage: "Cycle probe A" },
            status: "candidate",
            links: ["any-card"]
          },
          "color.b": {
            kind: "token",
            domain: "color",
            value: { alias: "semantic.color.a", usage: "Cycle probe B" },
            status: "candidate",
            links: ["any-card"]
          }
        },
        component: {}
      }, null, 2)}\n`,
      "utf-8"
    );
    expect(structuredContent(await declare({
      path: "design-system/token.json",
      artifactType: "token.json",
      semanticPurpose: "Alias cycle probe",
      relatedRecordIds: ["any-card"]
    }))).toMatchObject({ ok: false, error: "token_alias_cycle" });

    // Schema-valid file, but the declaration itself references no answered
    // card / annotation.
    writeFileSync(
      tokenPath,
      `${JSON.stringify({
        primitive: {
          "color.ink": {
            kind: "token",
            domain: "color",
            value: "#101418",
            status: "candidate",
            links: ["any-card"]
          }
        },
        semantic: {},
        component: {}
      }, null, 2)}\n`,
      "utf-8"
    );
    expect(structuredContent(await declare({
      path: "design-system/token.json",
      artifactType: "token.json",
      semanticPurpose: "Unlinked declaration probe"
    }))).toMatchObject({ ok: false, error: "unlinked_design_system_artifact" });

    // Links that resolve to neither an answered card nor an Agent annotation.
    expect(structuredContent(await declare({
      path: "design-system/token.json",
      artifactType: "token.json",
      semanticPurpose: "Dangling link probe",
      relatedRecordIds: ["card-that-does-not-exist"]
    }))).toMatchObject({
      ok: false,
      error: "link_not_answered_card_or_annotation"
    });

    // A valid in-scope path whose file was never written — the undeclared /
    // never-written file guard (Issue 08): existence is checked before ingest.
    expect(structuredContent(await declare({
      path: "prototype/never-written.html",
      artifactType: "prototype",
      semanticPurpose: "Missing file probe",
      relatedRecordIds: []
    }))).toMatchObject({ ok: false, error: "artifact_file_missing" });

    const invalidEvents = readEventLines(projectDir).filter(
      (event) => event.type === "invalid_artifact"
    );
    expect(invalidEvents.map((event) => event.payload?.reason)).toEqual([
      "unknown_artifact_type",
      "artifact_path_escape",
      "invalid_design_system_json",
      "token_alias_cycle",
      "unlinked_design_system_artifact",
      "link_not_answered_card_or_annotation",
      "artifact_file_missing"
    ]);
    // No failed declaration ever enters the artifact index.
    expect(listDeclaredArtifacts(projectDir)).toEqual([]);
  } finally {
    try {
      await client?.close();
    } catch {
      // ignore cleanup failure
    }
    killRecordedRuntime(stateDir);
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});

function countDesignSystemEntries(dir: string): number {
  const db = openIkranDb(path.join(dir, ".ikran", "ikran.db"));
  try {
    return (
      db.prepare("SELECT COUNT(*) AS count FROM design_system_entries").get() as {
        count: number;
      }
    ).count;
  } finally {
    db.close();
  }
}

test("formalized entry without a designer-edited link is rejected at ingest", async () => {
  test.setTimeout(180_000);
  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-artifact-xval-mcp-"));
  const projectDir = mkdtempSync(path.join(tmpdir(), "ikran-artifact-xval-project-"));
  let client: Client | null = null;
  try {
    const handle = await spawnMcpClient(stateDir);
    client = handle.client;
    const opened = structuredContent(await client.callTool({
      name: "create_or_open_project",
      arguments: { path: projectDir }
    }));
    expect(opened.ok).toBe(true);
    const token = String(opened.session);
    const workbenchUrl = String(opened.workbench_url);

    // Staging: one card answered with its proposed text — accepted as
    // agent-proposed (answer_source is designer-edited only when the final
    // wording differs from the proposal), so it can never back "formalized".
    expect(
      setDesignLanguageDescription(projectDir, "A calm, precise product language").ok
    ).toBe(true);
    const seed = registerSeedReference(projectDir, {
      figmaSeedReference: "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2",
      originalDesignIntent: "Artifact MCP cross-validation fixture"
    });
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    const evidence = recordEvidencePackage(projectDir, {
      seedReferenceId: seed.record.id,
      frame: { nodeId: "1:2", name: "Checkout" },
      evidenceViews: { rawData: "available", screenshot: "missing" }
    });
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) return;

    const preparedResponse = await fetch(
      new URL("/api/design-intent-alignment", workbenchUrl),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-ikran-session": token
        },
        body: JSON.stringify({ action: "prepare" })
      }
    );
    expect(preparedResponse.status).toBe(200);

    const staged = await stageAlignmentAnswering(client, {
      seedReferenceId: seed.record.id,
      evidenceId: evidence.record.id,
      keyPrefix: "artifact-xval"
    });
    const stagedCard = staged.cards["design-principle"][0];
    expect(structuredContent(await client.callTool({
      name: "record_designer_answer",
      arguments: { questionCardId: stagedCard.id, finalAnswer: stagedCard.answer }
    }))).toMatchObject({
      ok: true,
      record: { status: "answered" }
    });
    const cardId = stagedCard.id;

    // Schema-valid token.json whose only entry claims "formalized" backed by
    // an agent-accepted card. The declaration-level link check passes (the
    // card IS answered), so the rejection must come from the ingest-time
    // cross-validation (09A: 交叉校验必须在 ingest 时硬挡).
    const tokenPath = path.join(projectDir, "design-system", "token.json");
    mkdirSync(path.dirname(tokenPath), { recursive: true });
    writeFileSync(
      tokenPath,
      `${JSON.stringify({
        primitive: {
          "color.ink": {
            kind: "token",
            domain: "color",
            value: "#101418",
            status: "formalized",
            links: [cardId]
          }
        },
        semantic: {},
        component: {}
      }, null, 2)}\n`,
      "utf-8"
    );

    expect(structuredContent(await client.callTool({
      name: "record_artifact_written",
      arguments: {
        path: "design-system/token.json",
        artifactType: "token.json",
        semanticPurpose: "Formalized tier spoof probe",
        relatedRecordIds: [cardId]
      }
    }))).toMatchObject({
      ok: false,
      error: "formalized_requires_designer_edited_link"
    });

    const invalidEvents = readEventLines(projectDir).filter(
      (event) => event.type === "invalid_artifact"
    );
    expect(invalidEvents.map((event) => event.payload?.reason)).toEqual([
      "formalized_requires_designer_edited_link"
    ]);
    // The rejection is fully transactional: no artifact-index row, no entries.
    expect(listDeclaredArtifacts(projectDir)).toEqual([]);
    expect(countDesignSystemEntries(projectDir)).toBe(0);
  } finally {
    try {
      await client?.close();
    } catch {
      // ignore cleanup failure
    }
    killRecordedRuntime(stateDir);
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});
