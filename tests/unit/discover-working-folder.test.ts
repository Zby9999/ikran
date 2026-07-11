import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { resolveWorkingFolder } from "../../lib/mcp/discover-working-folder";

test.describe("resolveWorkingFolder", () => {
  test("prefers IKRAN_CWD env over roots and process cwd", () => {
    const roots = [{ uri: pathToFileURL("/tmp/from-roots").href }];
    const result = resolveWorkingFolder({
      envCwd: "/tmp/from-env",
      roots,
      processCwd: "/tmp/from-cwd"
    });
    expect(result).toEqual({
      folder: path.resolve("/tmp/from-env"),
      source: "env",
      roots: []
    });
  });

  test("uses first file:// root when env is unset", () => {
    const roots = [
      { uri: "https://example.com/not-a-folder" },
      { uri: pathToFileURL("/tmp/root-a").href, name: "a" },
      { uri: pathToFileURL("/tmp/root-b").href, name: "b" }
    ];
    const result = resolveWorkingFolder({
      envCwd: undefined,
      roots,
      processCwd: "/tmp/from-cwd"
    });
    expect(result.source).toBe("roots");
    expect(result.folder).toBe(path.resolve("/tmp/root-a"));
    expect(result.roots).toBe(roots);
  });

  test("falls back to process.cwd when env and roots are missing", () => {
    const result = resolveWorkingFolder({
      envCwd: "",
      roots: [],
      processCwd: "/tmp/mcp-launch-cwd"
    });
    expect(result).toEqual({
      folder: path.resolve("/tmp/mcp-launch-cwd"),
      source: "cwd",
      roots: []
    });
  });

  test("returns none when env, roots, and process cwd are all absent", () => {
    const result = resolveWorkingFolder({
      envCwd: null,
      roots: [{ uri: "not-a-file-uri" }],
      processCwd: null
    });
    expect(result.source).toBe("none");
    expect(result.folder).toBeNull();
  });

  test("trims env and process cwd strings", () => {
    expect(
      resolveWorkingFolder({ envCwd: "  /tmp/padded-env  " }).folder
    ).toBe(path.resolve("/tmp/padded-env"));
    expect(
      resolveWorkingFolder({
        processCwd: "  /tmp/padded-cwd  "
      }).folder
    ).toBe(path.resolve("/tmp/padded-cwd"));
  });

  test("skips malformed file:// root URIs and continues", () => {
    const roots = [
      { uri: "file://%E0%A4%A" },
      { uri: pathToFileURL("/tmp/good-root").href }
    ];
    const result = resolveWorkingFolder({ roots, processCwd: null });
    expect(result.source).toBe("roots");
    expect(result.folder).toBe(path.resolve("/tmp/good-root"));
  });
});
