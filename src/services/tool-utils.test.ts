import { describe, it, expect } from "vitest";
import {
  missingParam,
  errorResult,
  getErrorMessage,
  formatShortDate,
  formatDateTime,
  formatDateOnly,
  formatFileSize,
  requireString,
  requireArray,
} from "./tool-utils.js";

// ---------------------------------------------------------------------------
// missingParam
// ---------------------------------------------------------------------------

describe("missingParam", () => {
  it("returns error ToolResult with parameter name in message", () => {
    const result = missingParam("email");
    expect(result).toEqual({
      content: "Missing required parameter: email",
      isError: true,
    });
  });

  it("works with different parameter names", () => {
    const result = missingParam("taskId");
    expect(result.content).toBe("Missing required parameter: taskId");
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// errorResult
// ---------------------------------------------------------------------------

describe("errorResult", () => {
  it("returns error ToolResult with 'Error: ' prefix", () => {
    const result = errorResult("something went wrong");
    expect(result).toEqual({
      content: "Error: something went wrong",
      isError: true,
    });
  });

  it("works with different messages", () => {
    const result = errorResult("messageId is required");
    expect(result.content).toBe("Error: messageId is required");
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getErrorMessage
// ---------------------------------------------------------------------------

describe("getErrorMessage", () => {
  it("extracts message from Error instance", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("extracts message from Error subclass", () => {
    class CustomError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = "CustomError";
      }
    }
    expect(getErrorMessage(new CustomError("custom boom"))).toBe("custom boom");
  });

  it("stringifies non-Error string values", () => {
    expect(getErrorMessage("plain string")).toBe("plain string");
  });

  it("stringifies non-Error number values", () => {
    expect(getErrorMessage(42)).toBe("42");
  });

  it("stringifies null", () => {
    expect(getErrorMessage(null)).toBe("null");
  });

  it("stringifies undefined", () => {
    expect(getErrorMessage(undefined)).toBe("undefined");
  });

  it("stringifies an object", () => {
    const result = getErrorMessage({ code: 404 });
    expect(result).toBe("[object Object]");
  });
});

// ---------------------------------------------------------------------------
// formatShortDate
// ---------------------------------------------------------------------------

describe("formatShortDate", () => {
  it("formats ISO string to short date format", () => {
    const result = formatShortDate("2025-01-15T10:30:00Z");
    // Should be like "Jan 15, 2025"
    expect(result).toContain("Jan");
    expect(result).toContain("15");
    expect(result).toContain("2025");
  });

  it("returns 'unknown' for undefined", () => {
    expect(formatShortDate(undefined)).toBe("unknown");
  });

  it("returns 'unknown' when called without arguments", () => {
    expect(formatShortDate()).toBe("unknown");
  });

  it("formats different dates correctly", () => {
    // Use noon UTC to avoid timezone-boundary day shifts
    const result = formatShortDate("2024-12-25T12:00:00Z");
    expect(result).toContain("Dec");
    expect(result).toContain("25");
    expect(result).toContain("2024");
  });
});

// ---------------------------------------------------------------------------
// formatDateTime
// ---------------------------------------------------------------------------

describe("formatDateTime", () => {
  it("formats ISO string with date and time", () => {
    const result = formatDateTime("2025-01-15T14:30:00Z");
    // Should be like "Jan 15, 2025, 2:30 PM"
    expect(result).toContain("Jan");
    expect(result).toContain("15");
    expect(result).toContain("2025");
    // Time component
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it("returns original string on invalid date", () => {
    const result = formatDateTime("not-a-date");
    expect(result).toBe("not-a-date");
  });

  it("formats dates at noon UTC", () => {
    // Use noon UTC to avoid timezone-boundary day shifts
    const result = formatDateTime("2025-06-01T12:00:00Z");
    expect(result).toContain("Jun");
    expect(result).toContain("1");
    expect(result).toContain("2025");
  });
});

// ---------------------------------------------------------------------------
// formatDateOnly
// ---------------------------------------------------------------------------

describe("formatDateOnly", () => {
  it("extracts YYYY-MM-DD from ISO string", () => {
    expect(formatDateOnly("2025-01-15T10:30:00Z")).toBe("2025-01-15");
  });

  it("returns undefined for undefined input", () => {
    expect(formatDateOnly(undefined)).toBeUndefined();
  });

  it("returns undefined when called without arguments", () => {
    expect(formatDateOnly()).toBeUndefined();
  });

  it("handles date-only strings (no T)", () => {
    const result = formatDateOnly("2025-03-20");
    expect(result).toBe("2025-03-20");
  });

  it("handles ISO strings with timezone offsets", () => {
    expect(formatDateOnly("2025-07-04T12:00:00-05:00")).toBe("2025-07-04");
  });
});

// ---------------------------------------------------------------------------
// formatFileSize
// ---------------------------------------------------------------------------

describe("formatFileSize", () => {
  it("returns 'unknown' for undefined", () => {
    expect(formatFileSize(undefined)).toBe("unknown");
  });

  it("returns 'unknown' when called without arguments", () => {
    expect(formatFileSize()).toBe("unknown");
  });

  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    const result = formatFileSize(2048);
    expect(result).toBe("2.0 KB");
  });

  it("formats megabytes", () => {
    const result = formatFileSize(5 * 1024 * 1024);
    expect(result).toBe("5.0 MB");
  });

  it("formats gigabytes", () => {
    const result = formatFileSize(3 * 1024 * 1024 * 1024);
    expect(result).toBe("3.0 GB");
  });

  it("handles zero bytes", () => {
    expect(formatFileSize(0)).toBe("unknown");
  });

  it("handles boundary values", () => {
    expect(formatFileSize(1023)).toBe("1023 B");
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1024 * 1024 - 1)).toContain("KB");
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
  });
});

// ---------------------------------------------------------------------------
// requireString
// ---------------------------------------------------------------------------

describe("requireString", () => {
  it("returns trimmed string when present", () => {
    const result = requireString({ name: "  hello  " }, "name");
    expect(result).toBe("hello");
  });

  it("returns missingParam error when key is missing", () => {
    const result = requireString({}, "name");
    expect(typeof result).toBe("object");
    expect(result).toEqual({
      content: "Missing required parameter: name",
      isError: true,
    });
  });

  it("returns missingParam error when value is empty string", () => {
    const result = requireString({ name: "" }, "name");
    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("isError", true);
  });

  it("returns missingParam error when value is whitespace-only", () => {
    const result = requireString({ name: "   " }, "name");
    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("isError", true);
  });

  it("returns missingParam error when value is not a string", () => {
    const result = requireString({ name: 42 }, "name");
    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("isError", true);
  });

  it("returns the string value directly for valid input", () => {
    const result = requireString({ eventId: "abc123" }, "eventId");
    expect(result).toBe("abc123");
  });
});

// ---------------------------------------------------------------------------
// requireArray
// ---------------------------------------------------------------------------

describe("requireArray", () => {
  it("returns the array when present and non-empty", () => {
    const arr = ["a@b.com", "c@d.com"];
    const result = requireArray({ schedules: arr }, "schedules");
    expect(result).toEqual(arr);
  });

  it("returns missingParam error when key is missing", () => {
    const result = requireArray({}, "schedules");
    expect(typeof result).toBe("object");
    expect(result).toEqual({
      content: "Missing required parameter: schedules",
      isError: true,
    });
  });

  it("returns missingParam error when array is empty", () => {
    const result = requireArray({ items: [] }, "items");
    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("isError", true);
  });

  it("returns missingParam error when value is not an array", () => {
    const result = requireArray({ items: "not-array" }, "items");
    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("isError", true);
  });

  it("returns array with single element", () => {
    const result = requireArray({ ids: [42] }, "ids");
    expect(result).toEqual([42]);
  });
});
