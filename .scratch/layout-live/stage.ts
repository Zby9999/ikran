// Live staging for the 09C-B Layout Blueprint terminal-browser check.
// Mirrors tests/design-system-reader-split.spec.ts staging, then keeps the
// spawned Runtime alive so a persistent browser can explore the real
// Workbench. Scratch-only: never committed, never touches the repo project.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { recordEvidencePackage } from "../../lib/runtime/evidence-package";
import { setDesignLanguageDescription } from "../../lib/runtime/project-readiness";
import { registerSeedReference } from "../../lib/runtime/seed-reference";
import {
  killRecordedRuntime,
  spawnMcpClient,
  structuredContent
} from "../../tests/helpers/mcp";
import {
  ALIGNMENT_SECTIONS,
  stageAlignmentAnswering
} from "../../tests/helpers/alignment";

const ROOT = path.join(process.cwd(), ".scratch", "layout-live");
const stateDir = path.join(ROOT, "state");
const projectDir = path.join(ROOT, "project");

rmSync(stateDir, { recursive: true, force: true });
rmSync(projectDir, { recursive: true, force: true });
mkdirSync(stateDir, { recursive: true });
mkdirSync(path.join(projectDir, "design-system"), { recursive: true });

const handle = await spawnMcpClient(stateDir);
const client = handle.client;
const opened = structuredContent(
  await client.callTool({
    name: "create_or_open_project",
    arguments: { path: projectDir }
  })
);
if (opened.ok !== true) {
  throw new Error(`create_or_open_project failed: ${JSON.stringify(opened)}`);
}
const token = String(opened.session);
const workbenchUrl = String(opened.workbench_url);

const seed = registerSeedReference(projectDir, {
  figmaSeedReference:
    "https://www.figma.com/design/DsReader/Fixture?node-id=1:2",
  originalDesignIntent: "Layout blueprint live fixture"
});
if (!seed.ok) throw new Error(`seed failed: ${seed.reason}`);
const evidence = recordEvidencePackage(projectDir, {
  seedReferenceId: seed.record.id,
  frame: { nodeId: "1:2", name: "DS reader fixture" },
  evidenceViews: { rawData: "available", screenshot: "missing" }
});
if (!evidence.ok) throw new Error(`evidence failed: ${evidence.reason}`);
setDesignLanguageDescription(projectDir, "A calm, precise product language");

const patchAlignment = async (body: Record<string, unknown>) => {
  const res = await fetch(
    new URL("/api/design-intent-alignment", workbenchUrl),
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-ikran-session": token
      },
      body: JSON.stringify(body)
    }
  );
  if (res.status !== 200) {
    throw new Error(`alignment PATCH ${String(body.action)} → ${res.status}`);
  }
};

await patchAlignment({ action: "prepare" });
const staged = await stageAlignmentAnswering(client, {
  seedReferenceId: seed.record.id,
  evidenceId: evidence.record.id,
  keyPrefix: "layout-live"
});
const { cards } = staged;
const designerEditedCardId = cards["token"]![0]!.id;
await patchAlignment({
  action: "record-designer-answer",
  input: {
    questionCardId: designerEditedCardId,
    finalAnswer: "设计师改写后的回答"
  }
});
for (const section of ALIGNMENT_SECTIONS) {
  for (const card of cards[section]!) {
    if (card.id === designerEditedCardId) continue;
    const res = structuredContent(
      await client.callTool({
        name: "record_designer_answer",
        arguments: { questionCardId: card.id, finalAnswer: card.answer }
      })
    );
    if (res.ok !== true) {
      throw new Error(`record_designer_answer failed: ${JSON.stringify(res)}`);
    }
  }
}
await patchAlignment({ action: "complete" });

const writeSource = (relative: string, json: unknown) =>
  writeFileSync(
    path.join(projectDir, relative),
    `${JSON.stringify(json, null, 2)}\n`,
    "utf-8"
  );

writeSource("design-system/design-system.json", {
  name: "Ikran Reader System",
  visualLanguage: {
    id: "visual-language",
    value: { description: "Calm, precise product language." },
    meaning: "Overall visual tone",
    status: "formalized",
    links: [designerEditedCardId]
  },
  principles: [
    {
      id: "principle-intent",
      value:
        "Design with intent. Every choice across product surfaces needs a reason the designer can repeat. State the reason next to the choice; avoid decoration without a job, except for deliberate marketing one-offs.",
      meaning: "Intent over decoration",
      status: "candidate",
      links: [designerEditedCardId]
    }
  ]
});
writeSource("design-system/token.json", {
  primitive: {
    "font.family.sans": {
      value: "Instrument Sans, system-ui, sans-serif",
      meaning: "Primary typeface stack",
      status: "formalized",
      links: [designerEditedCardId],
      domain: "typography"
    },
    "font.size.400": {
      value: "16px",
      meaning: "Base body size",
      status: "formalized",
      links: [designerEditedCardId],
      domain: "typography"
    },
    "font.size.700": {
      value: "32px",
      meaning: "Alternate hero size",
      status: "formalized",
      links: [designerEditedCardId],
      domain: "typography"
    },
    "letterSpacing.hero": {
      value: "-0.04em",
      meaning: "Hero tracking",
      status: "formalized",
      links: [designerEditedCardId],
      domain: "typography"
    },
    "font.weight.bold": {
      value: "700",
      meaning: "Bold weight",
      status: "gap",
      links: [],
      domain: "typography"
    }
  },
  semantic: {
    body: {
      value: { family: "Inter", size: "16px", weight: "400", tracking: "0.01em" },
      meaning: "Default reading role",
      status: "candidate",
      links: [designerEditedCardId],
      domain: "typography"
    },
    "display.large": {
      value: {
        fontFamily: { alias: "primitive.font.family.sans" },
        fontSize: "64px",
        fontWeight: "700",
        lineHeight: "1.05"
      },
      meaning: "Hero display role",
      status: "formalized",
      links: [designerEditedCardId],
      domain: "typography"
    }
  },
  component: {}
});
writeSource("design-system/layout-rules.json", {
  sourceCaptures: [
    {
      artifactId: designerEditedCardId,
      nodeId: "11:49",
      capturedAt: "2026-08-03T00:00:00.000Z"
    }
  ],
  rules: [
    {
      id: "grid-page",
      value:
        "Use a 12-column page grid with the spacing.200 gutter and a maximum width of 1120px.",
      meaning: "Default page grid",
      status: "candidate",
      links: [designerEditedCardId]
    },
    {
      id: "shell-regions",
      value: "Stack the page shell as header, hero, content, then footer.",
      meaning: "Page shell vertical stack",
      status: "candidate",
      links: [designerEditedCardId]
    },
    {
      id: "section-rhythm",
      value:
        "Keep 96px between the hero and the following section on desktop, reducing to 56px on mobile.",
      meaning: "Scroll rhythm, desktop → mobile",
      status: "candidate",
      links: [designerEditedCardId]
    },
    {
      id: "breakpoints",
      value: "Use breakpoints at 640px, 768px, 1024px, and 1280px.",
      meaning: "Same source as code",
      status: "formalized",
      links: [designerEditedCardId]
    },
    {
      id: "nav-mobile",
      value:
        "The mobile navigation layout remains a documented gap until its open state is captured.",
      meaning: "Mobile navigation layout — open state missing",
      status: "gap",
      links: []
    }
  ]
});

const declareArtifact = async (artifactPath: string, artifactType: string) => {
  const res = structuredContent(
    await client.callTool({
      name: "record_artifact_written",
      arguments: {
        path: artifactPath,
        artifactType,
        semanticPurpose: `${artifactType} source`,
        relatedRecordIds: [designerEditedCardId]
      }
    })
  );
  if (res.ok !== true) {
    throw new Error(`declare ${artifactPath} failed: ${JSON.stringify(res)}`);
  }
};
await declareArtifact("design-system/design-system.json", "design-system.json");
await declareArtifact("design-system/token.json", "token.json");
await declareArtifact("design-system/layout-rules.json", "layout-rules.json");

console.log(`WORKBENCH_URL=${workbenchUrl}`);
console.log(`TOKEN=${token}`);
console.log(`PROJECT_DIR=${projectDir}`);
console.log("staging complete — runtime stays up; Ctrl+C to stop.");

const shutdown = () => {
  killRecordedRuntime(stateDir);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
