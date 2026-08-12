import { describe, expect, test } from "vitest";

import { normalizeTsxModuleNamespace } from "../../lib/runtime/tsx-module-interop.mjs";

describe("tsx module namespace interop", () => {
  test("exposes named functions from the Node 22 default-only shape", () => {
    const createRuntimeLifecycle = () => "lifecycle";
    const registerRuntimeControl = () => "registered";
    const commonJsExports = {
      createRuntimeLifecycle,
      registerRuntimeControl
    };

    const normalized = normalizeTsxModuleNamespace({
      default: commonJsExports
    });

    expect(normalized.createRuntimeLifecycle).toBe(createRuntimeLifecycle);
    expect(normalized.registerRuntimeControl).toBe(registerRuntimeControl);
    expect(normalized.default).toBe(commonJsExports);
  });

  test("preserves native named exports when newer Node exposes both shapes", () => {
    const native = () => "native";
    const fallback = () => "fallback";

    const normalized = normalizeTsxModuleNamespace({
      createRuntimeLifecycle: native,
      default: { createRuntimeLifecycle: fallback },
      "module.exports": { createRuntimeLifecycle: fallback }
    });

    expect(normalized.createRuntimeLifecycle).toBe(native);
  });

  test("exposes named functions from a module.exports-only namespace", () => {
    const createRuntimeLifecycle = () => "lifecycle";

    const normalized = normalizeTsxModuleNamespace({
      "module.exports": { createRuntimeLifecycle }
    });

    expect(normalized.createRuntimeLifecycle).toBe(createRuntimeLifecycle);
  });

  test("leaves a namespace without an object fallback unchanged", () => {
    const moduleNamespace = { default: "value", named: 42 };

    expect(normalizeTsxModuleNamespace(moduleNamespace)).toBe(moduleNamespace);
  });
});
