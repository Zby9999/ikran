// Test-only process preload: semantic MCP tools must not require global fetch.
globalThis.fetch = async () => {
  throw new Error("Task 10 no-loopback proof: global fetch is disabled");
};
