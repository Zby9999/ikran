// Browser-safe Prototype Surface route helpers.
//
// A dev server origin is shared infrastructure; a surface route identifies the
// page inside that server. Keep them separate so component harnesses can still
// be mounted from the origin while Prototype frames and screenshots open the
// declared page rather than always falling back to `/`.

export const DEFAULT_PROTOTYPE_ROUTE_PATH = "/";

export function normalizePrototypeRoutePath(value: unknown): string | null {
  if (value === undefined) return DEFAULT_PROTOTYPE_ROUTE_PATH;
  if (typeof value !== "string") return null;
  const routePath = value.trim();
  if (routePath === "" || routePath === "/") {
    return DEFAULT_PROTOTYPE_ROUTE_PATH;
  }
  if (
    !routePath.startsWith("/") ||
    routePath.startsWith("//") ||
    routePath.includes("\\") ||
    routePath.includes("?") ||
    routePath.includes("#")
  ) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(routePath);
  } catch {
    return null;
  }
  if (
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    decoded.includes("?") ||
    decoded.includes("#") ||
    decoded.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }
  return routePath;
}

export function composePrototypeSurfaceUrl(
  previewOrigin: string,
  routePath: string
): string {
  const origin = previewOrigin.trim().replace(/\/+$/, "");
  const normalizedRoute = normalizePrototypeRoutePath(routePath);
  if (origin.length === 0 || normalizedRoute === null) return "";
  return normalizedRoute === DEFAULT_PROTOTYPE_ROUTE_PATH
    ? origin
    : `${origin}${normalizedRoute}`;
}
