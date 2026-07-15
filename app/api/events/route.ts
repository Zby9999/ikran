// GET /api/events — Server-Sent Events stream (Runtime heartbeat + record
// invalidation).
//
// Same-origin + session authorized (session passed via `?session=` because
// EventSource cannot set custom request headers). The stream emits a heartbeat
// on connect and roughly every 1.5s so the Browser UI can prove the Runtime
// connection is live. After durable domain writes, `event: record` frames
// invalidate Workbench GET caches for the active project only.

import path from "node:path";
import type { NextRequest } from "next/server";
import { SERVICE } from "../../../lib/runtime/config";
import { getActiveProject } from "../../../lib/runtime/project";
import {
  subscribeRecordEvents,
  type RecordBusEvent
} from "../../../lib/runtime/record-bus";
import { authorize } from "../../../lib/runtime/session";
import { getRuntimeControl } from "../../../lib/runtime/runtime-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function matchesActiveProject(event: RecordBusEvent): boolean {
  const active = getActiveProject();
  if (!active) return false;
  return path.resolve(active) === path.resolve(event.projectPath);
}

export async function GET(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) {
    return new Response(JSON.stringify({ ok: false, error: auth.reason }), {
      status: auth.status,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  const encoder = new TextEncoder();
  const releaseWorkbenchLease =
    getRuntimeControl()?.lifecycle.acquire("workbench") ?? (() => {});
  let sequence = 0;
  let closed = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let unsubscribeRecords: (() => void) | undefined;

  const stop = () => {
    releaseWorkbenchLease();
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
    if (unsubscribeRecords) {
      unsubscribeRecords();
      unsubscribeRecords = undefined;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sendHeartbeat = () => {
        if (closed) {
          return;
        }
        sequence += 1;
        const payload = {
          type: "heartbeat",
          service: SERVICE,
          status: "ready",
          sequence,
          timestamp: new Date().toISOString()
        };
        controller.enqueue(
          encoder.encode(
            `event: heartbeat\ndata: ${JSON.stringify(payload)}\n\n`
          )
        );
      };

      const sendRecord = (event: RecordBusEvent) => {
        if (closed) return;
        if (!matchesActiveProject(event)) return;
        try {
          controller.enqueue(
            encoder.encode(`event: record\ndata: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          // Controller may already be closed; ignore.
        }
      };

      // Subscribe before any ready/heartbeat signal. Once the client observes
      // connection readiness, every subsequent committed record is covered.
      unsubscribeRecords = subscribeRecordEvents(sendRecord);
      sendHeartbeat();
      interval = setInterval(sendHeartbeat, 1500);

      const cleanup = () => {
        if (closed) {
          return;
        }
        closed = true;
        stop();
        try {
          controller.close();
        } catch {
          // Controller may already be closed; ignore.
        }
      };

      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      closed = true;
      stop();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
