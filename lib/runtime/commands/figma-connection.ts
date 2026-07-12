// Figma Connection Gate commands — installation-scoped PAT (Issue 05A).
// Responses never echo the token.

import {
  getFigmaApiClient,
  type FigmaAccountIdentity
} from "../figma-api";
import { getFigmaCredentialStore } from "../figma-credential-store";

export type FigmaConnectionStatus =
  | { connected: false }
  | { connected: true; account: FigmaAccountIdentity };

export type ConnectFigmaResult =
  | { ok: true; status: Extract<FigmaConnectionStatus, { connected: true }> }
  | {
      ok: false;
      reason: "missing_token" | "invalid_token" | "figma_api_error";
    };

export async function getFigmaConnectionStatusCommand(): Promise<FigmaConnectionStatus> {
  const store = getFigmaCredentialStore();
  const token = await store.get();
  if (!token) return { connected: false };

  const api = getFigmaApiClient();
  const validated = await api.validateToken(token);
  if (!validated.ok) {
    // Stale / revoked credential — treat as disconnected without leaking token.
    return { connected: false };
  }
  return { connected: true, account: validated.account };
}

/**
 * Validate a PAT against Figma, then persist only after success.
 * Invalid tokens must not enter the credential store.
 */
export async function connectFigmaCommand(
  tokenRaw: unknown
): Promise<ConnectFigmaResult> {
  if (typeof tokenRaw !== "string" || tokenRaw.trim().length === 0) {
    return { ok: false, reason: "missing_token" };
  }
  const token = tokenRaw.trim();
  const api = getFigmaApiClient();
  const validated = await api.validateToken(token);
  if (!validated.ok) {
    return {
      ok: false,
      reason: validated.reason === "invalid_token" ? "invalid_token" : "figma_api_error"
    };
  }

  const store = getFigmaCredentialStore();
  await store.set(token);
  return {
    ok: true,
    status: { connected: true, account: validated.account }
  };
}

export async function disconnectFigmaCommand(): Promise<{ ok: true }> {
  const store = getFigmaCredentialStore();
  await store.clear();
  return { ok: true };
}

export async function requireFigmaConnectionCommand(): Promise<
  | { ok: true; token: string; account: FigmaAccountIdentity }
  | { ok: false; reason: "figma_connection_required" }
> {
  const store = getFigmaCredentialStore();
  const token = await store.get();
  if (!token) {
    return { ok: false, reason: "figma_connection_required" };
  }
  const api = getFigmaApiClient();
  const validated = await api.validateToken(token);
  if (!validated.ok) {
    return { ok: false, reason: "figma_connection_required" };
  }
  return { ok: true, token, account: validated.account };
}
