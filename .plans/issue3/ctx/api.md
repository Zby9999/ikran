# API Routes Inventory — `app/api/*`

All five routes are Next.js Route Handlers running under
`export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`.
They are Runtime-side (not the agent harness), same-origin + session authorized.

---

## Shared: `authorize()` pattern

**Source:** `lib/runtime/session.ts`

```ts
export type AuthResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

export function authorize(request: NextRequest): AuthResult { ... }
```

- Enforces, in order: `host` header present → host parses → host is localhost
  (`isLocalhostHostname`) → if `Origin` header present, it must be same-origin
  → valid session token via **either** `x-ikran-session` header **or**
  `?session=` query param (the query path exists specifically because
  `EventSource` cannot set custom headers).
- Any failure → `{ ok: false, status: 403, reason: "<code>" }` where reason is
  one of `missing_host | invalid_host | nonlocal_host | invalid_origin |
  cross_origin | invalid_session`.
- Token is startup-level: `randomBytes(32).toString("hex")` stashed on
  `globalThis.__IKRAN_SESSION_TOKEN` so it survives Next.js HMR within one
  process but rotates per process.

**Import path depth varies by route location:**
- `app/api/<x>/route.ts` → `import { authorize } from "../../../lib/runtime/session";`
- `app/api/project/<x>/route.ts` → `import { authorize } from "../../../../lib/runtime/session";`

**Canonical call + error handling (JSON routes):**
```ts
const auth = authorize(request);
if (!auth.ok) {
  return NextResponse.json(
    { ok: false, error: auth.reason },
    { status: auth.status }
  );
}
```
The 403 `auth.status` and `auth.reason` are passed through verbatim; the body
shape is always `{ ok: false, error: <reason> }`.

---

## 1. `app/api/health/route.ts` — `GET /api/health`

- **Method:** `GET` (sync `function`, not `async`).
- **Imports:** `SERVICE` from `../../../lib/runtime/config`; `authorize` from
  `../../../lib/runtime/session`.
- **Auth:** canonical pattern above.
- **Success (200):**
  ```json
  { "ok": true, "status": "ready", "service": "<SERVICE>", "timestamp": "<ISO>" }
  ```
  with `headers: { "Cache-Control": "no-store" }`.
- **Failure (403):** `{ ok: false, error: auth.reason }`.
- **Purpose:** Runtime readiness for the same-origin Browser UI. The Ikran
  launcher polls the *document URL*, not this endpoint (because this endpoint
  requires a valid session token).

---

## 2. `app/api/project/route.ts` — `GET /api/project`

- **Method:** `GET` (async).
- **Imports:** `authorize` from `../../../lib/runtime/session`;
  `getActiveProjectState` from `../../../lib/runtime/project`;
  `getCwdCandidate` from `../../../lib/runtime/cwd-candidate`.
- **Auth:** canonical pattern.
- **Success (200):**
  ```json
  { "ok": true, "project": <project|null>, "cwd_candidate": <cwd|null> }
  ```
  - `project` = `getActiveProjectState().project` when `state.ok`, else `null`.
  - `cwd_candidate` = result of `getCwdCandidate()` (the folder the launcher
    forwarded via `IKRAN_CWD`, for auto-bind).
  - 200 even when no project is bound, so the UI can read `cwd_candidate`
    without a separate 404 path.
- **Failure (403):** `{ ok: false, error: auth.reason }`.

---

## 3. `app/api/project/select-folder/route.ts` — `POST /api/project/select-folder`

- **Method:** `POST` (async). No request body parsed.
- **Imports:** `authorize` from `../../../../lib/runtime/session`;
  `selectFolder` from `../../../../lib/runtime/folder-picker`;
  `bindProjectFolder` from `../../../../lib/runtime/project`.
- **Auth:** canonical pattern (depth `../../../../`).
- **Flow + status codes:**
  1. `selectFolder()` →
     - `reason === "cancelled"` → **200** (no status arg = default 200!)
       `{ ok: false, error: "native_picker_cancelled" }`.
     - other failure → **503**
       `{ ok: false, error: "native_picker_unavailable", detail, message }`.
  2. `bindProjectFolder(selected.path)` →
     - failure → **400** `{ ok: false, error: bindResult.reason, path }`.
     - success → **200** `{ ok: true, path, project: bindResult.config, events: bindResult.events }`.
- **Note:** the cancelled case returns 200 with `ok:false` — intentional so the
  UI treats cancel as a soft non-error.

---

## 4. `app/api/project/bind/route.ts` — `POST /api/project/bind`

- **Method:** `POST` (async).
- **Imports:** `authorize` from `../../../../lib/runtime/session`;
  `bindProjectFolder` from `../../../../lib/runtime/project`.
- **Auth:** canonical pattern (depth `../../../../`).
- **Request body:** `{ path?: string }` parsed via `await request.json()`.
  - bad JSON → **400** `{ ok: false, error: "invalid_json" }`.
  - missing/invalid `path` → **400** `{ ok: false, error: "missing_path" }`.
- **Flow:** `bindProjectFolder(body.path)` →
  - failure → **400** `{ ok: false, error: result.reason }`.
  - success → **200** `{ ok: true, project: result.config, events: result.events }`.
- **Side effects (per comment):** validates path, creates project-local
  `.ikran/` metadata (config, SQLite, JSONL events), records initial semantic
  events, updates Runtime-global active project pointer.

---

## 5. `app/api/events/route.ts` — `GET /api/events` (SSE) ⚑ CRITICAL

- **Method:** `GET` (async).
- **Imports:** `SERVICE` from `../../../lib/runtime/config`; `authorize` from
  `../../../lib/runtime/session`.
- **Auth:** authorize is called, but the error path is **different** from the
  JSON routes — it cannot use `NextResponse.json` because the success path
  returns a streaming `Response`:
  ```ts
  const auth = authorize(request);
  if (!auth.ok) {
    return new Response(JSON.stringify({ ok: false, error: auth.reason }), {
      status: auth.status,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
  ```
  Session is delivered via `?session=` query (EventSource can't set headers).

### How it implements SSE today

- **Mechanism:** a hand-rolled `ReadableStream<Uint8Array>` + `TextEncoder`.
  It does **NOT** read from any EventEmitter bus. There is no pub/sub
  subscription, no channel multiplexing, no task-id filtering.
- **What it emits:** heartbeats only.
  - One heartbeat sent immediately in `start(controller)` (before the interval
    is armed).
  - Then `setInterval(sendHeartbeat, 1500)` every ~1.5 s.
- **Event name / frame format:** a single SSE event named `heartbeat`:
  ```
  event: heartbeat
  data: {"type":"heartbeat","service":"<SERVICE>","status":"ready","sequence":<n>,"timestamp":"<ISO>"}

  ```
  (trailing blank line = SSE event terminator). `sequence` is a monotonically
  incrementing integer scoped to this one connection.
- **Channels / event names:** exactly one — `heartbeat`. No other event names
  are defined. No `task` channel, no `project` channel, nothing else flows.
- **Multiplexing of multiple sources:** **none.** The stream is a single
  `setInterval` timer; there is no fan-in from other producers. The only
  "source" is the heartbeat closure.
- **Task-id filtering:** **none.** There is no concept of a task id in this
  route. No query param is read for filtering (only `session`).
- **Response headers (success, 200):**
  ```
  Content-Type: text/event-stream; charset=utf-8
  Cache-Control: no-cache, no-transform
  Connection: keep-alive
  X-Accel-Buffering: no
  ```
  `X-Accel-Buffering: no` disables Nginx proxy buffering.
- **Lifecycle / cleanup:**
  - `closed` boolean guard prevents enqueuing after close.
  - `request.signal.addEventListener("abort", cleanup, { once: true })` → on
    client disconnect: sets `closed`, clears interval, calls `controller.close()`
    inside try/catch (controller may already be closed).
  - `cancel()` on the ReadableStream also sets `closed = true` and stops the
    interval (Next.js invokes this on connection drop).
  - `stop()` = `clearInterval(interval)`; idempotent.

### Constraint for the new task channel

> A new task channel must flow through THIS same stream: single multiplexed
> SSE, no per-task SSE, no polling.

Today the stream has **no EventEmitter bus wiring at all** — it is purely a
heartbeat timer. To add a task channel without violating the constraint, the
`start(controller)` closure must additionally subscribe to a shared
EventEmitter/bus (e.g. the same Runtime bus that task progress is published to)
and enqueue additional SSE frames of the form:

```
event: <eventName>
data: <json>

```

alongside the existing `heartbeat` frames, using the same `controller.enqueue(
encoder.encode(...))` mechanism and the same `closed` guard. The existing
`abort`/`cancel` cleanup must also **unsubscribe** from the bus (current
`stop()` only clears the interval — it would need to remove the listener too,
or the route will leak listeners across reconnects). Multiplexing is achieved
purely by interleaving SSE `event:`-named frames on one stream; task-id
filtering would be done by reading an additional query param (e.g.
`?task=<id>`) at the top of the handler and gating which bus events get
enqueued. No per-task SSE endpoint, no polling.