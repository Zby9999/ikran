import { describe, expect, test } from "vitest";
import {
  isWorkbenchViewInUrl,
  WORKBENCH_VIEW_PARAM,
  WORKBENCH_VIEW_VALUE
} from "@/components/setup/workbench-view";

describe("workbench-view query flag", () => {
  test("detects view=workbench in search string", () => {
    expect(isWorkbenchViewInUrl("?session=abc&view=workbench")).toBe(true);
    expect(isWorkbenchViewInUrl("?view=workbench")).toBe(true);
    expect(isWorkbenchViewInUrl("?session=abc")).toBe(false);
    expect(isWorkbenchViewInUrl("")).toBe(false);
  });

  test("exports stable param names", () => {
    expect(WORKBENCH_VIEW_PARAM).toBe("view");
    expect(WORKBENCH_VIEW_VALUE).toBe("workbench");
  });
});
