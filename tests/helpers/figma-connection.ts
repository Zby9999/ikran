// Deterministic Figma Connection helpers for Playwright (Issue 05A).
// Requires IKRAN_FIGMA_CREDENTIAL_STORE=memory + IKRAN_FIGMA_API_MODE=mock
// (set in tests/fixtures.ts).

import { expect } from "@playwright/test";
import { rawPost } from "./http";

/** Open the installation-scoped Figma Connection Gate with the mock PAT. */
export async function connectFigmaForTests(
  port: number,
  sessionToken: string
): Promise<void> {
  const res = await rawPost(
    port,
    "/api/figma-connection",
    { token: "figd_ok_e2e" },
    {
      host: `127.0.0.1:${port}`,
      "x-ikran-session": sessionToken,
      "content-type": "application/json"
    }
  );
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toMatchObject({
    ok: true,
    connected: true
  });
}
