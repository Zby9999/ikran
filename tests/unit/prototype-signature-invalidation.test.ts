import { expect, test } from "vitest";
import { prototypeSignature } from "../../components/runtime/use-workbench-runtime";
import type { PrototypeSurfaceRecord } from "../../lib/runtime/prototype-surface";

function surface(
  partial: Partial<PrototypeSurfaceRecord> = {}
): PrototypeSurfaceRecord {
  return {
    id: "surface-1",
    prototype_run_id: "run-1",
    run_id: "run-1",
    surface_key: "home",
    name: "Home",
    preview_url: "http://127.0.0.1:4300/",
    route_path: "/",
    surface_url: "http://127.0.0.1:4300",
    preview_port: 4300,
    readiness: "ready",
    readiness_reason: null,
    stale: false,
    stale_reason: null,
    screenshot_artifact_path: null,
    screenshot_captured_at: null,
    created_at: "2026-08-07T00:00:00.000Z",
    updated_at: "2026-08-07T00:00:00.000Z",
    ...partial
  };
}

test("post-capture screenshot invalidates the Prototype surface projection", () => {
  // Readiness is already "ready" when the async headless capture lands; only
  // the screenshot fields change, and they must still invalidate the state or
  // the unfocused surface keeps the text placeholder forever.
  const before = surface();
  const after = surface({
    screenshot_artifact_path: ".ikran/artifacts/prototype-media/surface-1.png",
    screenshot_captured_at: "2026-08-07T00:00:05.000Z"
  });

  expect(prototypeSignature([after])).not.toBe(prototypeSignature([before]));
});

test("a route correction invalidates the Prototype surface projection", () => {
  const before = surface();
  const after = surface({
    route_path: "/projects/atlas",
    surface_url: "http://127.0.0.1:4300/projects/atlas"
  });

  expect(prototypeSignature([after])).not.toBe(prototypeSignature([before]));
});
