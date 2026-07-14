import { expect, test } from "vitest";
import {
  findExistingSeedIdForPasteUrl,
  hasInFlightSeedForPasteUrl
} from "../../components/workbench/find-existing-seed-for-paste";
import type { SeedReferenceRecord } from "../../lib/runtime/seed-reference";

function seed(
  partial: Partial<SeedReferenceRecord> & Pick<SeedReferenceRecord, "id">
): SeedReferenceRecord {
  return {
    figma_seed_reference: "https://www.figma.com/design/AbCdEf/File?node-id=1-2",
    original_design_intent: "",
    created_at: "2026-01-01T00:00:00.000Z",
    registered_via: "ui",
    file_key: "AbCdEf",
    node_id: "1:2",
    current_surface_id: "",
    ...partial
  };
}

test.describe("findExistingSeedIdForPasteUrl", () => {
  test("matches fileKey + nodeId ignoring share token noise", () => {
    const seeds = [
      seed({ id: "seed-a" }),
      seed({
        id: "seed-b",
        file_key: "Other",
        node_id: "3:4",
        figma_seed_reference:
          "https://www.figma.com/design/Other/File?node-id=3-4"
      })
    ];
    expect(
      findExistingSeedIdForPasteUrl(
        seeds,
        "https://www.figma.com/design/AbCdEf/File?node-id=1:2&t=noise"
      )
    ).toBe("seed-a");
  });

  test("returns null for a new identity", () => {
    const seeds = [seed({ id: "seed-a" })];
    expect(
      findExistingSeedIdForPasteUrl(
        seeds,
        "https://www.figma.com/design/AbCdEf/File?node-id=9-9"
      )
    ).toBeNull();
  });

  test("falls back to parsing stored URL when file_key is empty", () => {
    const seeds = [
      seed({
        id: "legacy",
        file_key: "",
        node_id: "",
        figma_seed_reference:
          "https://www.figma.com/design/AbCdEf/File?node-id=0-81"
      })
    ];
    expect(
      findExistingSeedIdForPasteUrl(
        seeds,
        "https://www.figma.com/design/AbCdEf/File?node-id=0:81"
      )
    ).toBe("legacy");
  });
});

test("hasInFlightSeedForPasteUrl matches canonical URL variants", () => {
  expect(
    hasInFlightSeedForPasteUrl(
      [
        {
          figmaSeedReference:
            "https://www.figma.com/design/AbCdEf/File?node-id=1-2"
        }
      ],
      "https://www.figma.com/design/AbCdEf/File?node-id=1:2&t=noise"
    )
  ).toBe(true);
});
