// GET /api/events — Server-Sent Events stream (Runtime heartbeat / status).
//
// Same-origin + session authorized (session passed via `?session=` because
// EventSource cannot set custom request headers). The stream emits a heartbeat
// on connect and roughly every 1.5s so the Browser UI can prove the Runtime
// connection is live without low-level UI polling.
//
// In addition to heartbeats, this single stream multiplexes live task
// progress from the in-process task bus (`lib/runtime/task-bus`). Task frames
// use the SSE event name `task`. An optional `?task=<id>` query param filters
// which task events are forwarded (still one stream — no per-task SSE). There
// is no polling: the bus is push-only and the route unsubscribes on disconnect
// to avoid listener leaks across reconnects.

import type { NextRequest } from "next/server";
import { SERVICE } from "../../../lib/runtime/config";
import { authorize } from "../../../lib/runtime/session";
import { onTaskEvent, type TaskBusEvent } from "../../../lib/runtime/task-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) {
    return new Response(JSON.stringify({ ok: false, error: auth.reason }), {
      status: auth.status,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  // Optional task-id filter for the multiplexed task channel. `null` (no
  // filter) forwards every task event; a specific id forwards only that
  // task's events. Either way it is the same single SSE stream.
  const filterTaskId = request.nextUrl.searchParams.get("task") ?? null;

  const encoder = new TextEncoder();
  let sequence = 0;
  let closed = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | null = null;

  const stop = () => {
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
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

      // Task bus → SSE `task` frames, multiplexed onto this one stream.
      const sendTaskEvent = (ev: TaskBusEvent) => {
        if (closed) {
          return;
        }
        if (filterTaskId && ev.taskId !== filterTaskId) {
          return;
        }
        controller.enqueue(
          encoder.encode(`event: task\ndata: ${JSON.stringify(ev)}\n\n`)
        );
      };
      unsubscribe = onTaskEvent(sendTaskEvent);

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