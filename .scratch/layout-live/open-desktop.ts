// Open the user's real Desktop project in a prod Runtime (e2e build + mock
// Figma). Open-only: no seeding, no fixtures, no writes beyond the product's
// own project metadata. Scratch-only script — never committed.

import path from "node:path";
import {
  killRecordedRuntime,
  spawnMcpClient,
  structuredContent
} from "../../tests/helpers/mcp";

const stateDir = path.join(
  process.cwd(),
  ".scratch",
  "layout-live",
  "state-desktop"
);
const PROJECT = "/Users/bingyizhang/Desktop/ikran test 7";

const handle = await spawnMcpClient(stateDir);
const opened = structuredContent(
  await handle.client.callTool({
    name: "create_or_open_project",
    arguments: { path: PROJECT }
  })
);
if (opened.ok !== true) {
  throw new Error(`create_or_open_project failed: ${JSON.stringify(opened)}`);
}

console.log(`WORKBENCH_URL=${String(opened.workbench_url)}`);
console.log("runtime stays up; Ctrl+C to stop.");

const shutdown = () => {
  killRecordedRuntime(stateDir);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
