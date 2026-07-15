import { expect, test } from "vitest";
import {
  WORKBENCH_TOAST_FADE_MS,
  WORKBENCH_TOAST_VISIBLE_MS,
  workbenchToastPhaseAt
} from "../../components/workbench/workbench-toast-alert";

test("Workbench alerts stay visible for two seconds, then fade and disappear", () => {
  expect(WORKBENCH_TOAST_VISIBLE_MS).toBe(2_000);
  expect(WORKBENCH_TOAST_FADE_MS).toBe(300);
  expect(workbenchToastPhaseAt(0)).toBe("visible");
  expect(workbenchToastPhaseAt(1_999)).toBe("visible");
  expect(workbenchToastPhaseAt(2_000)).toBe("exiting");
  expect(workbenchToastPhaseAt(2_299)).toBe("exiting");
  expect(workbenchToastPhaseAt(2_300)).toBe("hidden");
});
