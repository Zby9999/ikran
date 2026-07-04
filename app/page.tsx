// Server component entrypoint.
//
// Renders the designer's existing (Figma-owned) project setup screen. The
// startup-level session token is injected here so the client card can call the
// same-origin `/api/*` Runtime API. The page is dynamic so the token reflects
// the current Runtime startup, not a value baked at build time.
//
// Do NOT add UI design here. All visual/interaction design must come from the
// designer via Figma (see /AGENTS.md).

import { ProjectSetupCard } from "../components/setup/ProjectSetupCard";
import { SERVICE } from "../lib/runtime/config";
import { getSessionToken } from "../lib/runtime/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = getSessionToken();
  return <ProjectSetupCard bootstrap={{ session, service: SERVICE }} />;
}