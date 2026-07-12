/** Query flag that keeps the Seed Evidence Workbench open across reloads. */
export const WORKBENCH_VIEW_PARAM = "view";
export const WORKBENCH_VIEW_VALUE = "workbench";

export function isWorkbenchViewInUrl(
  search: string = typeof window !== "undefined" ? window.location.search : ""
): boolean {
  return new URLSearchParams(search).get(WORKBENCH_VIEW_PARAM) === WORKBENCH_VIEW_VALUE;
}

/** Sync the Workbench view flag into the address bar without navigating. */
export function setWorkbenchViewInUrl(enabled: boolean): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (enabled) {
    url.searchParams.set(WORKBENCH_VIEW_PARAM, WORKBENCH_VIEW_VALUE);
  } else {
    url.searchParams.delete(WORKBENCH_VIEW_PARAM);
  }
  window.history.replaceState(window.history.state, "", url);
}
