import http from "node:http";

export type RecordSseConnection = {
  close: () => void;
  waitForRecord: (timeoutMs?: number) => Promise<Record<string, unknown>>;
};

/** Open the Runtime record-invalidation stream for one authenticated session. */
export function openRecordSse(
  port: number,
  session: string
): Promise<RecordSseConnection> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/events?session=${encodeURIComponent(session)}`,
        method: "GET",
        headers: {
          host: `127.0.0.1:${port}`,
          Accept: "text/event-stream"
        }
      },
      (response) => {
        if ((response.statusCode ?? 0) !== 200) {
          reject(new Error(`SSE status ${response.statusCode}`));
          return;
        }

        let buffer = "";
        const pending: Array<{
          resolve: (value: Record<string, unknown>) => void;
          timer: ReturnType<typeof setTimeout>;
        }> = [];
        const queued: Record<string, unknown>[] = [];

        response.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf8");
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const lines = frame.split("\n");
            const event = lines
              .find((line) => line.startsWith("event:"))
              ?.slice(6)
              .trim();
            const data = lines
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("");
            if (event !== "record" || !data) continue;
            const record = JSON.parse(data) as Record<string, unknown>;
            const waiter = pending.shift();
            if (waiter) {
              clearTimeout(waiter.timer);
              waiter.resolve(record);
            }
            else queued.push(record);
          }
        });

        resolve({
          close: () => {
            request.destroy();
            response.destroy();
          },
          waitForRecord: (timeoutMs = 10_000) =>
            new Promise((resolveRecord, rejectRecord) => {
              const queuedRecord = queued.shift();
              if (queuedRecord) {
                resolveRecord(queuedRecord);
                return;
              }
              const waiter = {
                resolve: resolveRecord,
                timer: setTimeout(() => {
                  const index = pending.indexOf(waiter);
                  if (index >= 0) pending.splice(index, 1);
                  rejectRecord(new Error("timeout waiting for record event"));
                }, timeoutMs)
              };
              pending.push(waiter);
            })
        });
      }
    );
    request.on("error", reject);
    request.end();
  });
}
