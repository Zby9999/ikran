import http from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { isLocalhostHostname } from "@/lib/runtime/config";
import {
  canonicalizeLocalhostHost,
  composeHostHeader,
  composeWorkbenchUrl,
  formatHostForUrl,
  isLocalhostHost,
  stripHostBrackets,
  waitForReady
} from "@/lib/runtime/http-server.mjs";

const hangingServers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    hangingServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          if (typeof server.closeAllConnections === "function") {
            try {
              server.closeAllConnections();
            } catch {
              /* ignore */
            }
          }
        })
    )
  );
});

describe("http-server host URL composition", () => {
  test("composeWorkbenchUrl encodes session and uses host:port form", () => {
    expect(composeWorkbenchUrl("127.0.0.1", 54321, "deadbeef")).toBe(
      "http://127.0.0.1:54321/?session=deadbeef&view=workbench"
    );
    expect(composeWorkbenchUrl("127.0.0.1", 54321, "a b/c")).toBe(
      "http://127.0.0.1:54321/?session=a%20b%2Fc&view=workbench"
    );
  });

  test("composeWorkbenchUrl brackets IPv6 localhost", () => {
    expect(composeWorkbenchUrl("::1", 54321, "deadbeef")).toBe(
      "http://[::1]:54321/?session=deadbeef&view=workbench"
    );
    expect(composeWorkbenchUrl("[::1]", 54321, "deadbeef")).toBe(
      "http://[::1]:54321/?session=deadbeef&view=workbench"
    );
  });

  test("formatHostForUrl / composeHostHeader canonicalize IPv6", () => {
    expect(formatHostForUrl("::1")).toBe("[::1]");
    expect(formatHostForUrl("[::1]")).toBe("[::1]");
    expect(composeHostHeader("::1", 3000)).toBe("[::1]:3000");
    expect(composeHostHeader("127.0.0.1", 3000)).toBe("127.0.0.1:3000");
  });

  test("canonicalizeLocalhostHost accepts bracketed ::1 and rejects others", () => {
    expect(canonicalizeLocalhostHost("::1")).toBe("::1");
    expect(canonicalizeLocalhostHost("[::1]")).toBe("::1");
    expect(canonicalizeLocalhostHost("127.0.0.1")).toBe("127.0.0.1");
    expect(isLocalhostHost("[::1]")).toBe(true);
    expect(stripHostBrackets("[::1]")).toBe("::1");
    expect(() => canonicalizeLocalhostHost("0.0.0.0")).toThrow(/non-localhost/);
    expect(() => canonicalizeLocalhostHost("example.com")).toThrow(
      /non-localhost/
    );
  });

  test("composed IPv6 workbench URL is parseable", () => {
    const url = composeWorkbenchUrl("::1", 54321, "abc");
    const parsed = new URL(url);
    expect(parsed.protocol).toBe("http:");
    expect(stripHostBrackets(parsed.hostname)).toBe("::1");
    expect(parsed.port).toBe("54321");
    expect(parsed.searchParams.get("session")).toBe("abc");
    expect(parsed.searchParams.get("view")).toBe("workbench");
  });
});

describe("session localhost hostname allowlist (IPv6)", () => {
  test("accepts bare and bracketed ::1 from URL.hostname", () => {
    expect(isLocalhostHostname("::1")).toBe(true);
    expect(isLocalhostHostname("[::1]")).toBe(true);
    expect(isLocalhostHostname("127.0.0.1")).toBe(true);
    expect(isLocalhostHostname("evil.example")).toBe(false);
  });
});

describe("waitForReady AbortController timeout", () => {
  test("aborts when the server never responds", async () => {
    const server = http.createServer((_req, _res) => {
      // Intentionally hang — no response headers/body.
    });
    hangingServers.push(server);

    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("no port"));
      });
    });

    const started = Date.now();
    await expect(waitForReady("127.0.0.1", port, 400)).rejects.toThrow(
      /did not become ready within 400ms/
    );
    const elapsed = Date.now() - started;
    // Must abort promptly — not hang on the open socket indefinitely.
    expect(elapsed).toBeLessThan(2500);
  });

  test("resolves when the server answers 2xx", async () => {
    const server = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    });
    hangingServers.push(server);

    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("no port"));
      });
    });

    await expect(waitForReady("127.0.0.1", port, 2000)).resolves.toBeUndefined();
  });
});
