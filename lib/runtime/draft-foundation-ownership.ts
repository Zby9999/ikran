export const DRAFT_FOUNDATION_OWNERS = [
  "color",
  "typography",
  "material"
] as const;

export type DraftFoundationOwner =
  (typeof DRAFT_FOUNDATION_OWNERS)[number];

export const DRAFT_FOUNDATION_TOKEN_DOMAINS = {
  color: ["color"],
  typography: ["typography"],
  material: [
    "spacing",
    "size",
    "ratio",
    "radius",
    "border",
    "shadow",
    "opacity"
  ]
} as const;

export const NON_FOUNDATION_TOKEN_DOMAIN_ROUTES = {
  motion: { owner: "interaction", work_unit: "interaction" },
  breakpoint: { owner: "layout", work_unit: "layout" },
  other: { owner: "unresolved", work_unit: null }
} as const;

export function draftFoundationOwnerForTokenDomain(
  domain: string | null
): DraftFoundationOwner | null {
  if (domain === "color") return "color";
  if (domain === "typography") return "typography";
  return (DRAFT_FOUNDATION_TOKEN_DOMAINS.material as readonly string[]).includes(
    domain ?? ""
  )
    ? "material"
    : null;
}

export function reviewedDraftFoundationOwnersAreComplete(
  owners: readonly string[] | undefined
): boolean {
  return (
    owners?.length === DRAFT_FOUNDATION_OWNERS.length &&
    DRAFT_FOUNDATION_OWNERS.every((owner) => owners.includes(owner))
  );
}
