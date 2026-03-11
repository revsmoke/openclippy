import { describe, it, expect } from "vitest";
import { getEnabledServiceIds } from "./helpers.js";

describe("getEnabledServiceIds", () => {
  it("returns empty array when services is undefined", () => {
    const result = getEnabledServiceIds({});
    expect(result).toEqual([]);
  });

  it("returns empty array when services is empty object", () => {
    const result = getEnabledServiceIds({ services: {} });
    expect(result).toEqual([]);
  });

  it("returns only enabled service IDs", () => {
    const result = getEnabledServiceIds({
      services: {
        mail: { enabled: true },
        calendar: { enabled: true },
      },
    });
    expect(result).toEqual(["mail", "calendar"]);
  });

  it("excludes disabled services", () => {
    const result = getEnabledServiceIds({
      services: {
        mail: { enabled: true },
        calendar: { enabled: false },
      },
    });
    expect(result).toEqual(["mail"]);
  });

  it("excludes services with no enabled field", () => {
    const result = getEnabledServiceIds({
      services: {
        mail: { enabled: true },
        calendar: {},
      },
    });
    expect(result).toEqual(["mail"]);
  });

  it("handles mixed enabled/disabled/missing services", () => {
    const result = getEnabledServiceIds({
      services: {
        mail: { enabled: true },
        calendar: { enabled: false },
        todo: {},
        "teams-chat": { enabled: true },
        onedrive: { enabled: false },
        planner: { enabled: true },
      },
    });
    expect(result).toEqual(["mail", "teams-chat", "planner"]);
  });

  it("returns string[] compatible with ServiceId type", () => {
    const result = getEnabledServiceIds({
      services: {
        "custom-plugin": { enabled: true },
      },
    });
    expect(result).toEqual(["custom-plugin"]);
    expect(typeof result[0]).toBe("string");
  });
});
