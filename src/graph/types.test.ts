import { describe, it, expect } from "vitest";
import { buildODataQuery } from "./types.js";

describe("buildODataQuery", () => {
  it("builds empty string for no params", () => {
    expect(buildODataQuery({})).toBe("");
  });

  it("builds select query", () => {
    expect(buildODataQuery({ $select: "id,subject" })).toBe("?$select=id,subject");
  });

  it("builds combined query", () => {
    const query = buildODataQuery({
      $select: "id,subject",
      $top: 10,
      $orderby: "receivedDateTime desc",
    });
    expect(query).toContain("$select=id,subject");
    expect(query).toContain("$top=10");
    expect(query).toContain("$orderby=receivedDateTime desc");
  });

  it("encodes filter values", () => {
    const query = buildODataQuery({ $filter: "isRead eq false" });
    expect(query).toContain("$filter=");
  });

  it("wraps search in quotes", () => {
    const query = buildODataQuery({ $search: "important meeting" });
    expect(query).toContain('$search="');
  });
});
