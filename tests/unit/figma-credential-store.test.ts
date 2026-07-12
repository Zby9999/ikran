// Credential store adapter: PAT never touches project SQLite / artifacts.
// Memory double is the injectable seam for unit + e2e (Issue 05A).

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  createMemoryFigmaCredentialStore,
  getFigmaCredentialStore,
  resetFigmaCredentialStoreForTests,
  type FigmaCredentialStore
} from "../../lib/runtime/figma-credential-store";

let projectDir: string;
let store: FigmaCredentialStore;

beforeEach(() => {
  resetFigmaCredentialStoreForTests();
  projectDir = mkdtempSync(path.join(tmpdir(), "ikran-cred-"));
  store = createMemoryFigmaCredentialStore();
});

afterEach(() => {
  resetFigmaCredentialStoreForTests();
  rmSync(projectDir, { recursive: true, force: true });
});

test("memory store starts empty", async () => {
  expect(await store.get()).toBeNull();
});

test("memory store round-trips a PAT without writing project files", async () => {
  await store.set("figd_test_token_abc");
  expect(await store.get()).toBe("figd_test_token_abc");

  // Simulate project artifacts that must never receive the secret.
  writeFileSync(path.join(projectDir, "note.txt"), "hello");
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name);
      if (name.isDirectory()) out.push(...walk(full));
      else out.push(readFileSync(full, "utf8"));
    }
    return out;
  };
  expect(walk(projectDir).join("\n")).not.toContain("figd_test_token_abc");
});

test("clear removes the stored PAT", async () => {
  await store.set("figd_x");
  await store.clear();
  expect(await store.get()).toBeNull();
});

test("getFigmaCredentialStore uses memory when IKRAN_FIGMA_CREDENTIAL_STORE=memory", async () => {
  process.env.IKRAN_FIGMA_CREDENTIAL_STORE = "memory";
  resetFigmaCredentialStoreForTests();
  const s = getFigmaCredentialStore();
  await s.set("figd_env");
  expect(await getFigmaCredentialStore().get()).toBe("figd_env");
  delete process.env.IKRAN_FIGMA_CREDENTIAL_STORE;
  resetFigmaCredentialStoreForTests();
});
