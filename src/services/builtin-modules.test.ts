import { describe, it, expect, vi } from "vitest";
import { builtinModules, registerBuiltinModules } from "./builtin-modules.js";
import type { ServiceRegistry } from "./registry.js";

describe("builtinModules", () => {
  it("exports an array of exactly 10 service modules", () => {
    expect(Array.isArray(builtinModules)).toBe(true);
    expect(builtinModules).toHaveLength(10);
  });

  it("each module has a unique id property", () => {
    const ids = builtinModules.map((m) => m.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

describe("registerBuiltinModules", () => {
  it("calls registry.register() for each module", () => {
    const mockRegistry = {
      register: vi.fn(),
    } as unknown as ServiceRegistry;

    registerBuiltinModules(mockRegistry);

    expect(mockRegistry.register).toHaveBeenCalledTimes(10);

    // Verify each module was registered
    for (const mod of builtinModules) {
      expect(mockRegistry.register).toHaveBeenCalledWith(mod);
    }
  });
});
