type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function requestRuntimeShutdown(
  session: string,
  fetcher: Fetcher = fetch
): Promise<void> {
  const response = await fetcher("/api/runtime/stop", {
    method: "POST",
    headers: { "x-ikran-session": session }
  });
  if (response.status !== 202) {
    throw new Error(`Runtime rejected shutdown (${response.status})`);
  }
}
