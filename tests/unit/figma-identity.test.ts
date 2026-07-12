// Unit tests for DB-free canonical Figma seed identity parse/normalize/equality.

import { test, expect } from "vitest";
import {
  extractFigmaDesignUrl,
  figmaSeedIdentitiesEqual,
  hasFigmaDesignOrFilePath,
  isFigmaDesignUrl,
  isFigmaHostname,
  normalizeFigmaNodeId,
  parseFigmaSeedIdentity
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

  test("percent-encoded node-id decodes before normalize", () => {
    const encoded = parseFigmaSeedIdentity(
      "https://www.figma.com/design/AbCdEf/X?node-id=0%3A81&t=share"
    );
    const dashed = parseFigmaSeedIdentity(
      "https://www.figma.com/design/AbCdEf/X?node-id=0-81"
    );
    expect(encoded).toEqual({ fileKey: "AbCdEf", nodeId: "0:81" });
    expect(figmaSeedIdentitiesEqual(encoded!, dashed!)).toBe(true);
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

  test("shared host / path helpers match parse dialect", () => {
    expect(isFigmaHostname("figma.com")).toBe(true);
    expect(isFigmaHostname("www.figma.com")).toBe(true);
    expect(isFigmaHostname("api.figma.com")).toBe(false);
    expect(hasFigmaDesignOrFilePath("/design/AbCd/File")).toBe(true);
    expect(hasFigmaDesignOrFilePath("/file/AbCd/File")).toBe(true);
    expect(hasFigmaDesignOrFilePath("/proto/AbCd/File")).toBe(false);
  });

  test("isFigmaDesignUrl / extractFigmaDesignUrl cover design + file only", () => {
    const design = "https://www.figma.com/design/AbCd/File?node-id=1-2";
    const file = "https://www.figma.com/file/AbCd/File?node-id=1-2";
    expect(isFigmaDesignUrl(design)).toBe(true);
    expect(extractFigmaDesignUrl(`paste ${design} here`)).toBe(design);
    expect(extractFigmaDesignUrl(file)).toBe(file);
    expect(isFigmaDesignUrl("https://www.figma.com/proto/AbCd/File")).toBe(
      false
    );
  });
});
