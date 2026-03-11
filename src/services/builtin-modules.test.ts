import { describe, it, expect, vi } from "vitest";
import { builtinModules, registerBuiltinModules } from "./builtin-modules.js";
import { BUILTIN_SERVICE_IDS } from "../config/types.services.js";
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

  it("BUILTIN_SERVICE_IDS matches builtinModules IDs", () => {
    const moduleIds = builtinModules.map((m) => m.id).sort();
    const constIds = [...BUILTIN_SERVICE_IDS].sort();
    expect(moduleIds).toEqual(constIds);
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
