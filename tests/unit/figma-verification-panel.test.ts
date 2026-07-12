import { expect, test } from "vitest";
import { tokenPanelPhaseFromValue } from "../../components/workbench/figma-verification-panel";

test("empty token → empty phase", () => {
  expect(
    tokenPanelPhaseFromValue("", {
      verifying: false,
      verified: false,
      error: null
    })
  ).toBe("empty");
});

test("non-empty token → ready (check button)", () => {
  expect(
    tokenPanelPhaseFromValue("figd_x", {
      verifying: false,
      verified: false,
      error: null
    })
  ).toBe("ready");
});

test("verified → verified phase", () => {
  expect(
    tokenPanelPhaseFromValue("figd_x", {
      verifying: false,
      verified: true,
      error: null
    })
  ).toBe("verified");
});
