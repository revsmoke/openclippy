import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Person, Contact } from "./types.js";
import {
  peopleSearchTool,
  contactsListTool,
  contactsReadTool,
} from "./tools.js";
import { createToolContext } from "../../test-utils/graph-mock.js";

// ---------------------------------------------------------------------------
// Mock graphRequest
// ---------------------------------------------------------------------------

const mockGraphRequest = vi.fn();

vi.mock("../../graph/client.js", () => ({
  graphRequest: (...args: unknown[]) => mockGraphRequest(...args),
}));

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

const ctx = createToolContext();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const samplePerson: Person = {
  id: "person-1",
  displayName: "Jane Smith",
  givenName: "Jane",
  surname: "Smith",
  scoredEmailAddresses: [
    { address: "jane.smith@contoso.com", relevanceScore: 10 },
  ],
  phones: [{ type: "business", number: "+1-555-0100" }],
  personType: { class: "Person", subclass: "OrganizationUser" },
  jobTitle: "Software Engineer",
  department: "Engineering",
  companyName: "Contoso",
};

const samplePersonMinimal: Person = {
  id: "person-2",
  displayName: "John Doe",
};

const sampleContact: Contact = {
  id: "contact-1",
  displayName: "Alice Johnson",
  givenName: "Alice",
  surname: "Johnson",
  emailAddresses: [
    { address: "alice@example.com", name: "Alice Johnson" },
    { address: "alice.j@work.com", name: "Alice J" },
  ],
  businessPhones: ["+1-555-0200"],
  mobilePhone: "+1-555-0201",
  jobTitle: "Product Manager",
  companyName: "Fabrikam",
  department: "Product",
  officeLocation: "Building 5",
  homeAddress: {
    street: "123 Main St",
    city: "Seattle",
    state: "WA",
    postalCode: "98101",
    countryOrRegion: "US",
  },
  personalNotes: "Met at conference",
  createdDateTime: "2025-01-10T08:00:00Z",
};

const sampleContactMinimal: Contact = {
  id: "contact-2",
  displayName: "Bob Wilson",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGraphRequest.mockReset();
});

describe("people_search", () => {
  const tool = peopleSearchTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("people_search");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.required).toContain("query");
  });

  it("searches people with query and formats results", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [samplePerson, samplePersonMinimal],
    });

    const result = await tool.execute({ query: "Jane" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("2 people");
    expect(result.content).toContain("Jane Smith");
    expect(result.content).toContain("jane.smith@contoso.com");
    expect(result.content).toContain("Software Engineer");
    expect(result.content).toContain("Engineering");
    expect(result.content).toContain("Contoso");
    expect(result.content).toContain("+1-555-0100");
    expect(result.content).toContain("John Doe");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        path: expect.stringContaining("/me/people"),
        headers: expect.objectContaining({
          ConsistencyLevel: "eventual",
        }),
      }),
    );

    // Verify $search parameter is in the path
    const callPath = mockGraphRequest.mock.calls[0][0].path as string;
    expect(callPath).toContain("$search=");
    expect(callPath).toContain("Jane");
  });

  it("respects top parameter", async () => {
    mockGraphRequest.mockResolvedValue({ value: [samplePerson] });

    await tool.execute({ query: "Jane", top: 5 }, ctx);

    const callPath = mockGraphRequest.mock.calls[0][0].path as string;
    expect(callPath).toContain("$top=5");
  });

  it("returns message when no people found", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({ query: "nonexistent" }, ctx);

    expect(result.content).toContain("No people found");
  });

  it("returns error when query is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("query");
  });

  it("formats person with minimal data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [samplePersonMinimal],
    });

    const result = await tool.execute({ query: "John" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("John Doe");
    expect(result.content).toContain("1 people");
  });
});

describe("contacts_list", () => {
  const tool = contactsListTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("contacts_list");
    expect(tool.description).toBeTruthy();
  });

  it("lists contacts with formatted output", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleContact, sampleContactMinimal],
    });

    const result = await tool.execute({}, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("2 contact(s)");
    expect(result.content).toContain("Alice Johnson");
    expect(result.content).toContain("alice@example.com");
    expect(result.content).toContain("Product Manager");
    expect(result.content).toContain("Fabrikam");
    expect(result.content).toContain("Bob Wilson");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        path: expect.stringContaining("/me/contacts"),
      }),
    );
  });

  it("applies top parameter", async () => {
    mockGraphRequest.mockResolvedValue({ value: [sampleContact] });

    await tool.execute({ top: 10 }, ctx);

    const callPath = mockGraphRequest.mock.calls[0][0].path as string;
    expect(callPath).toContain("$top=10");
  });

  it("applies orderBy parameter", async () => {
    mockGraphRequest.mockResolvedValue({ value: [sampleContact] });

    await tool.execute({ orderBy: "givenName" }, ctx);

    const callPath = mockGraphRequest.mock.calls[0][0].path as string;
    expect(callPath).toContain("$orderby=givenName");
  });

  it("returns message when no contacts found", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({}, ctx);

    expect(result.content).toContain("No contacts found");
  });
});

describe("contacts_read", () => {
  const tool = contactsReadTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("contacts_read");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.required).toContain("contactId");
  });

  it("reads a contact with full details", async () => {
    mockGraphRequest.mockResolvedValue(sampleContact);

    const result = await tool.execute({ contactId: "contact-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Alice Johnson");
    expect(result.content).toContain("alice@example.com");
    expect(result.content).toContain("alice.j@work.com");
    expect(result.content).toContain("+1-555-0200");
    expect(result.content).toContain("+1-555-0201");
    expect(result.content).toContain("Product Manager");
    expect(result.content).toContain("Fabrikam");
    expect(result.content).toContain("Product");
    expect(result.content).toContain("Building 5");
    expect(result.content).toContain("123 Main St");
    expect(result.content).toContain("Seattle");
    expect(result.content).toContain("Met at conference");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        path: "/me/contacts/contact-1",
      }),
    );
  });

  it("reads a contact with minimal data", async () => {
    mockGraphRequest.mockResolvedValue(sampleContactMinimal);

    const result = await tool.execute({ contactId: "contact-2" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Bob Wilson");
  });

  it("returns error when contactId is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("contactId");
  });
});

describe("peopleModule integration", () => {
  it("exports 3 tools with correct names", async () => {
    const { peopleModule } = await import("./module.js");
    const tools = peopleModule.tools();

    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual([
      "people_search",
      "contacts_list",
      "contacts_read",
    ]);
  });

  it("has correct module metadata", async () => {
    const { peopleModule } = await import("./module.js");

    expect(peopleModule.id).toBe("people");
    expect(peopleModule.meta.requiredScopes).toContain("People.Read");
    expect(peopleModule.meta.requiredScopes).toContain("Contacts.Read");
    expect(peopleModule.capabilities.read).toBe(true);
    expect(peopleModule.capabilities.write).toBe(false);
    expect(peopleModule.capabilities.delete).toBe(false);
    expect(peopleModule.capabilities.search).toBe(true);
  });

  it("provides prompt hints", async () => {
    const { peopleModule } = await import("./module.js");

    const hints = peopleModule.promptHints?.();
    expect(hints).toBeDefined();
    expect(hints!.length).toBeGreaterThan(0);
  });
});
