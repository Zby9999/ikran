// Installation-scoped Figma PAT credential store (ADR 0003 / Issue 05A).
//
// Production uses macOS Keychain via the `security` CLI. Tests and e2e inject
// an in-memory adapter through `IKRAN_FIGMA_CREDENTIAL_STORE=memory` or
// `setFigmaCredentialStoreForTests`. The PAT never enters project SQLite,
// `.ikran/`, artifacts, events, or research export.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type FigmaCredentialStore = {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
};

const KEYCHAIN_SERVICE = "ikran.figma-connection";
const KEYCHAIN_ACCOUNT = "personal-access-token";

export function createMemoryFigmaCredentialStore(
  initial: string | null = null
): FigmaCredentialStore {
  let token = initial;
  return {
    async get() {
      return token;
    },
    async set(next: string) {
      token = next;
    },
    async clear() {
      token = null;
    }
  };
}

function createKeychainFigmaCredentialStore(): FigmaCredentialStore {
  return {
    async get() {
      try {
        const { stdout } = await execFileAsync(
          "security",
          [
            "find-generic-password",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            KEYCHAIN_ACCOUNT,
            "-w"
          ],
          { encoding: "utf8" }
        );
        const value = stdout.trim();
        return value.length > 0 ? value : null;
      } catch {
        return null;
      }
    },
    async set(token: string) {
      // Replace any existing item so updates do not leave stale secrets.
      try {
        await execFileAsync("security", [
          "delete-generic-password",
          "-s",
          KEYCHAIN_SERVICE,
          "-a",
          KEYCHAIN_ACCOUNT
        ]);
      } catch {
        // absent is fine
      }
      await execFileAsync("security", [
        "add-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        KEYCHAIN_ACCOUNT,
        "-w",
        token,
        "-U"
      ]);
    },
    async clear() {
      try {
        await execFileAsync("security", [
          "delete-generic-password",
          "-s",
          KEYCHAIN_SERVICE,
          "-a",
          KEYCHAIN_ACCOUNT
        ]);
      } catch {
        // absent is fine
      }
    }
  };
}

let override: FigmaCredentialStore | null = null;
let cached: FigmaCredentialStore | null = null;

export function setFigmaCredentialStoreForTests(
  store: FigmaCredentialStore | null
): void {
  override = store;
  cached = null;
}

export function resetFigmaCredentialStoreForTests(): void {
  override = null;
  cached = null;
}

export function getFigmaCredentialStore(): FigmaCredentialStore {
  if (override) return override;
  if (cached) return cached;

  if (process.env.IKRAN_FIGMA_CREDENTIAL_STORE === "memory") {
    cached = createMemoryFigmaCredentialStore();
    return cached;
  }

  cached = createKeychainFigmaCredentialStore();
  return cached;
}
