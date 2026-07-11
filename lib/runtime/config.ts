// Ikran Runtime configuration.
//
// The Runtime is a single local process (the Next.js server) that hosts the
// Browser UI and exposes the `/api/*` Runtime API from the same origin. It
// binds 127.0.0.1 only and rejects broad CORS so that local filesystem /
// command-execution capabilities are never reachable by arbitrary websites.

export const SERVICE = "ikran-runtime";
export const HOST = process.env.IKRAN_HOST || "127.0.0.1";
export const PORT = Number(process.env.IKRAN_PORT || 3000);

// Hostnames that count as "local" for same-origin / localhost enforcement.
// Any other hostname (e.g. a rebinding domain) must be rejected fail-closed.
// Node's URL.hostname may keep IPv6 brackets (`[::1]`); strip before compare.
const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function stripHostBrackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]") && hostname.includes(":")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

export function isLocalhostHostname(hostname: string): boolean {
  return LOCALHOST_HOSTNAMES.has(stripHostBrackets(hostname));
}