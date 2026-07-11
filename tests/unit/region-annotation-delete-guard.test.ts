// Projection delete vs user delete permission for Region Annotation markers.

import { test, expect } from "vitest";
import { allowRegionAnnotationDelete } from "../../components/workbench/region-annotation-delete-guard";

test.describe("region annotation delete guard", () => {
  test("user path blocks Agent markers", () => {
    expect(
      allowRegionAnnotationDelete({
        author: "agent",
        runtimeRecordId: "ann-agent-1",
        source: "user",
        annotateMode: false
      })
    ).toBe(false);
  });

  test("remote/projection path allows Agent marker cleanup", () => {
    expect(
      allowRegionAnnotationDelete({
        author: "agent",
        runtimeRecordId: "ann-agent-1",
        source: "remote",
        annotateMode: false
      })
    ).toBe(true);
  });

  test("remote path allows Agent cleanup even while Annotate is on", () => {
    expect(
      allowRegionAnnotationDelete({
        author: "agent",
        runtimeRecordId: "ann-agent-1",
        source: "remote",
        annotateMode: true
      })
    ).toBe(true);
  });

  test("user path allows designer when Annotate is off", () => {
    expect(
      allowRegionAnnotationDelete({
        author: "designer",
        runtimeRecordId: "ann-des-1",
        source: "user",
        annotateMode: false
      })
    ).toBe(true);
  });

  test("user path blocks designer while Annotate is on", () => {
    expect(
      allowRegionAnnotationDelete({
        author: "designer",
        runtimeRecordId: "ann-des-1",
        source: "user",
        annotateMode: true
      })
    ).toBe(false);
  });

  test("drafts are always deletable on user path", () => {
    expect(
      allowRegionAnnotationDelete({
        author: "agent",
        runtimeRecordId: "draft",
        source: "user",
        annotateMode: true
      })
    ).toBe(true);
    expect(
      allowRegionAnnotationDelete({
        author: "designer",
        runtimeRecordId: "draft:local-1",
        source: "user",
        annotateMode: true
      })
    ).toBe(true);
  });
});
