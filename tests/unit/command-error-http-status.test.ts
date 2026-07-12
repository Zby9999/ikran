import { describe, expect, test } from "vitest";
import { commandErrorHttpStatus } from "../../lib/runtime/commands/http-status";

describe("commandErrorHttpStatus", () => {
  test("maps db_error to 500 so clients may retry", () => {
    expect(commandErrorHttpStatus("db_error")).toBe(500);
  });

  test("maps read_failed to 500", () => {
    expect(commandErrorHttpStatus("read_failed")).toBe(500);
  });

  test("maps project_mismatch conflict to 409", () => {
    expect(commandErrorHttpStatus("project_mismatch")).toBe(409);
  });

  test("maps not_found to 404", () => {
    expect(commandErrorHttpStatus("not_found")).toBe(404);
  });

  test("maps endpoint_retired to 410", () => {
    expect(commandErrorHttpStatus("endpoint_retired")).toBe(410);
  });

  test("maps client / validation / fail-closed domain reasons to 400", () => {
    const clientReasons = [
      "invalid_json",
      "invalid_params",
      "missing_path",
      "no_active_project",
      "missing_config",
      "ui_registration_disabled",
      "invalid_figma_url",
      "seed_reference_not_found",
      "seed_reference_mismatch",
      "frame_node_mismatch",
      "screenshot_required_when_available",
      "missing_surface_anchor",
      "not_deletable",
      "surface_not_found",
      "surface_ambiguous",
      "not_a_directory",
      "path_not_found",
      "not_accessible"
    ];
    for (const reason of clientReasons) {
      expect(commandErrorHttpStatus(reason), reason).toBe(400);
    }
  });

  test("unknown reasons default to 400 (fail-closed client)", () => {
    expect(commandErrorHttpStatus("totally_new_reason")).toBe(400);
  });
});
