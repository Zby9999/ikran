// Node 22 + tsx exposes TypeScript modules in a package without `type: module`
// as a default-only CommonJS namespace. Newer Node releases also synthesize
// the named exports. Runtime entrypoints must support both shapes because the
// release contract starts at Node 22.13.

export function normalizeTsxModuleNamespace(moduleNamespace) {
  const candidates = [
    moduleNamespace["module.exports"],
    moduleNamespace.default
  ].filter(
    (value) =>
      value !== null &&
      (typeof value === "object" || typeof value === "function")
  );
  if (candidates.length === 0) {
    return moduleNamespace;
  }

  // Prefer default over the explicit CJS marker, then native/synthetic named
  // exports over both when a newer Node release exposes every representation.
  return Object.assign({}, ...candidates, moduleNamespace);
}

export async function importTsxModule(specifier) {
  return normalizeTsxModuleNamespace(await import(specifier));
}
