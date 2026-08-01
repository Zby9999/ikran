// One-shot: re-declare layout-rules.json for the running Desktop-project
// Runtime so it re-ingests the structured transcription.

import path from "node:path";
import { spawnMcpClient, structuredContent } from "../../tests/helpers/mcp";

const stateDir = path.join(
  process.cwd(),
  ".scratch",
  "layout-live",
  "state-desktop"
);

const handle = await spawnMcpClient(stateDir);
const res = structuredContent(
  await handle.client.callTool({
    name: "record_artifact_written",
    arguments: {
      path: "design-system/layout-rules.json",
      artifactType: "layout-rules.json",
      semanticPurpose: "layout-rules.json source",
      relatedRecordIds: [
        "eb8e615d-313b-4644-8811-8bad758ed5dc",
        "1c9a67fa-1be4-405a-8959-ca9d341ef0bd",
        "d5e05c49-dcb8-421d-8304-e735b51dff25",
        "f168167a-ebda-4e14-8e0d-924eac94c255"
      ]
    }
  })
);
console.log(JSON.stringify(res));
process.exit(res.ok === true ? 0 : 1);
