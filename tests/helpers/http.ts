// Shared low-level HTTP helpers for Playwright e2e / Workbench specs.
// Prefer these over per-file rawGet/rawPost copies so Host / Content-Type
// handling stays consistent across HTTP boundary tests.

import http from "node:http";

export type HttpResult = { status: number; body: string };

/**
 * GET against the worker Runtime on 127.0.0.1:{port}.
 * Callers control Host / Origin / session headers for same-origin proofs.
 */
export function rawGet(
  port: number,
  route: string,
  headers: Record<string, string> = {}
): Promise<HttpResult> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: route,
        method: "GET",
        headers
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.end();
  });
}

/**
 * POST JSON against the worker Runtime on 127.0.0.1:{port}.
 * Sets Content-Type / Content-Length; callers may override via headers.
 */
export function rawPost(
  port: number,
  route: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<HttpResult> {
  return new Promise((resolve) => {
    const json = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: route,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(json),
          ...headers
        }
      },
      (res) => {
        let bodyText = "";
        res.on("data", (chunk) => {
          bodyText += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: bodyText }));
      }
    );
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.write(json);
    req.end();
  });
}
