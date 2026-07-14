import { afterEach, beforeEach, expect, test } from "vitest";
import {
  createMemoryFigmaCredentialStore,
  resetFigmaCredentialStoreForTests,
  setFigmaCredentialStoreForTests
} from "../../lib/runtime/figma-credential-store";
import {
  resetFigmaApiClientForTests,
  setFigmaApiClientForTests,
  type FigmaApiClient
} from "../../lib/runtime/figma-api";
import {
  connectFigmaCommand,
  getFigmaConnectionStatusCommand,
  requireFigmaConnectionCommand
} from "../../lib/runtime/commands/figma-connection";

const validClient: FigmaApiClient = {
  async validateToken(token) {
    if (token === "figd_good") {
      return { ok: true, account: { handle: "designer", email: "d@example.com" } };
    }
    return { ok: false, reason: "invalid_token" };
  },
  async capturePositionalEvidence() {
    return { ok: false, reason: "figma_api_error" };
  }
};

beforeEach(() => {
  resetFigmaCredentialStoreForTests();
  resetFigmaApiClientForTests();
  setFigmaCredentialStoreForTests(createMemoryFigmaCredentialStore());
  setFigmaApiClientForTests(validClient);
});

afterEach(() => {
  resetFigmaCredentialStoreForTests();
  resetFigmaApiClientForTests();
});

test("status is disconnected when store is empty", async () => {
  expect(await getFigmaConnectionStatusCommand()).toEqual({ connected: false });
});

test("invalid PAT does not enter credential store", async () => {
  const result = await connectFigmaCommand("figd_bad");
  expect(result).toEqual({ ok: false, reason: "invalid_token" });
  expect(await getFigmaConnectionStatusCommand()).toEqual({ connected: false });
});

test("valid PAT opens connection and status never returns the token", async () => {
  const result = await connectFigmaCommand("figd_good");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.status).toEqual({
    connected: true,
    account: { handle: "designer", email: "d@example.com" }
  });
  const status = await getFigmaConnectionStatusCommand();
  expect(JSON.stringify(status)).not.toContain("figd_good");
  expect(status).toEqual({
    connected: true,
    account: { handle: "designer", email: "d@example.com" }
  });
});

test("empty token is rejected", async () => {
  expect(await connectFigmaCommand("  ")).toEqual({
    ok: false,
    reason: "missing_token"
  });
});

test("connection preserves a Figma API timeout instead of reporting a bad token", async () => {
  setFigmaApiClientForTests({
    ...validClient,
    async validateToken() {
      return { ok: false, reason: "figma_api_timeout" };
    }
  });

  expect(await connectFigmaCommand("figd_slow")).toEqual({
    ok: false,
    reason: "figma_api_timeout"
  });
});

test("connection gate propagates timeout to capture commands", async () => {
  setFigmaCredentialStoreForTests(
    createMemoryFigmaCredentialStore("figd_slow")
  );
  setFigmaApiClientForTests({
    ...validClient,
    async validateToken() {
      return { ok: false, reason: "figma_api_timeout" };
    }
  });

  expect(await requireFigmaConnectionCommand()).toEqual({
    ok: false,
    reason: "figma_api_timeout"
  });
});
