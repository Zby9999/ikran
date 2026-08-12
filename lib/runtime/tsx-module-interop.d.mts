export function normalizeTsxModuleNamespace(
  moduleNamespace: Record<string, unknown>
): Record<string, unknown>;

export function importTsxModule(
  specifier: string | URL
): Promise<Record<string, unknown>>;
