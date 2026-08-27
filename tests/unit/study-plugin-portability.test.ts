import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { assertPortableNextExternals } from "../../scripts/release/smoke-study-plugin.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

test("packaged Next build requires every hashed external alias", () => {
  const root = fixtureRoot("missing");
  write(
    path.join(root, ".next/server/chunks/project.js"),
    'const ts = require("typescript-279735412610ef8d");\n'
  );

  expect(() => assertPortableNextExternals(root)).toThrow(
    /missing external alias: typescript-279735412610ef8d/
  );
});

test("packaged Next build accepts aliases that resolve inside the plugin", () => {
  const root = fixtureRoot("portable");
  write(
    path.join(root, ".next/server/chunks/project.js"),
    'const ts = require("typescript-279735412610ef8d");\n'
  );
  write(path.join(root, "node_modules/typescript/package.json"), '{"name":"typescript"}\n');
  const aliases = path.join(root, ".next/node_modules");
  mkdirSync(aliases, { recursive: true });
  symlinkSync(
    "../../node_modules/typescript",
    path.join(aliases, "typescript-279735412610ef8d")
  );

  expect(assertPortableNextExternals(root)).toEqual({
    aliases: ["typescript-279735412610ef8d"]
  });
});

function fixtureRoot(label: string) {
  const root = mkdtempSync(path.join(tmpdir(), `ikran-study-portability-${label}-`));
  temporaryDirectories.push(root);
  return root;
}

function write(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}
