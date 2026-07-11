// Unit tests for DB-free canonical Figma seed identity parse/normalize/equality.

import { test, expect } from "vitest";
import {
  parseFigmaSeedIdentity,
  figmaSeedIdentitiesEqual,
  normalizeFigmaNodeId
} from "../../lib/runtime/figma-identity";

test.describe("figma-identity (canonical)", () => {
  test("parseFigmaSeedIdentity extracts fileKey and normalizes node-id", () => {
    const a = parseFigmaSeedIdentity(
      "https://www.figma.com/design/AbCdEf/X?node-id=0-81&t=foo"
    );
    const b = parseFigmaSeedIdentity(
      "https://www.figma.com/design/AbCdEf/X?node-id=0:81"
    );
    expect(a).toEqual({ fileKey: "AbCdEf", nodeId: "0:81" });
    expect(b).toEqual({ fileKey: "AbCdEf", nodeId: "0:81" });
    expect(figmaSeedIdentitiesEqual(a!, b!)).toBe(true);
  });

  test("missing node-id becomes empty string", () => {
    const id = parseFigmaSeedIdentity(
      "https://www.figma.com/design/AbCdEf/Checkout"
    );
    expect(id).toEqual({ fileKey: "AbCdEf", nodeId: "" });
  });

  test("normalizeFigmaNodeId replaces dashes with colons", () => {
    expect(normalizeFigmaNodeId("0-81")).toBe("0:81");
    expect(normalizeFigmaNodeId("0:81")).toBe("0:81");
    expect(normalizeFigmaNodeId(" 1-2 ")).toBe("1:2");
  });

  test("rejects non-figma / invalid URLs", () => {
    expect(parseFigmaSeedIdentity("not-a-url")).toBeNull();
    expect(
      parseFigmaSeedIdentity("http://www.figma.com/design/AbCdEf/X")
    ).toBeNull();
    expect(
      parseFigmaSeedIdentity("https://example.com/design/AbCdEf/X")
    ).toBeNull();
    expect(
      parseFigmaSeedIdentity("https://www.figma.com/proto/AbCdEf/X")
    ).toBeNull();
  });
});
