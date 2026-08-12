export const RULE_UPDATE_FOUNDATION_CATEGORIES = [
  "foundations.home",
  "foundations.color",
  "foundations.typography",
  "foundations.materials",
  "foundations.layout",
  "foundations.interaction"
] as const;

export type RuleUpdateFoundationCategory =
  (typeof RULE_UPDATE_FOUNDATION_CATEGORIES)[number];
export type RuleUpdateCategory =
  | RuleUpdateFoundationCategory
  | `component:${string}`;

const FOUNDATION_ARTIFACTS: Record<RuleUpdateFoundationCategory, string> = {
  "foundations.home": "design-system/design-system.json",
  "foundations.color": "design-system/token.json",
  "foundations.typography": "design-system/token.json",
  "foundations.materials": "design-system/token.json",
  "foundations.layout": "design-system/layout-rules.json",
  "foundations.interaction": "design-system/interaction-rules.json"
};

const FOUNDATION_LABELS: Record<RuleUpdateFoundationCategory, string> = {
  "foundations.home": "Home",
  "foundations.color": "Color",
  "foundations.typography": "Typography",
  "foundations.materials": "Materials",
  "foundations.layout": "Layout",
  "foundations.interaction": "Interaction"
};

export function isRuleUpdateCategory(value: string): value is RuleUpdateCategory {
  return (
    RULE_UPDATE_FOUNDATION_CATEGORIES.includes(
      value as RuleUpdateFoundationCategory
    ) ||
    (value.startsWith("component:") && value.length > "component:".length)
  );
}

export function ruleUpdateFoundationArtifact(
  category: RuleUpdateCategory
): string | null {
  return category.startsWith("component:")
    ? null
    : FOUNDATION_ARTIFACTS[category as RuleUpdateFoundationCategory];
}

export function ruleUpdateCategoryArtifact(category: RuleUpdateCategory): string {
  return (
    ruleUpdateFoundationArtifact(category) ??
    `design-system/components/${category.slice("component:".length)}.json`
  );
}

export function ruleUpdateCategoryLabel(category: RuleUpdateCategory): string {
  return category.startsWith("component:")
    ? category.slice("component:".length)
    : FOUNDATION_LABELS[category as RuleUpdateFoundationCategory];
}

export function ruleUpdateCategories(
  components: readonly RuleUpdateCategory[]
): RuleUpdateCategory[] {
  return [...RULE_UPDATE_FOUNDATION_CATEGORIES, ...components];
}
