import { graphRequest } from "../../graph/client.js";
import type { GraphCollectionResponse } from "../../graph/client.js";
import { buildODataQuery } from "../../graph/types.js";
import type { AgentTool, ToolContext, ToolResult } from "../types.js";
import type { Person, Contact, PhysicalAddress } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function missingParam(name: string): ToolResult {
  return { content: `Missing required parameter: ${name}`, isError: true };
}

function formatPerson(person: Person): string {
  const parts: string[] = [`- ${person.displayName}`];

  const emails = person.scoredEmailAddresses?.map((e) => e.address).join(", ");
  if (emails) parts.push(`  Email: ${emails}`);

  const phones = person.phones?.map((p) => p.number).join(", ");
  if (phones) parts.push(`  Phone: ${phones}`);

  if (person.jobTitle) parts.push(`  Title: ${person.jobTitle}`);
  if (person.department) parts.push(`  Department: ${person.department}`);
  if (person.companyName) parts.push(`  Company: ${person.companyName}`);

  parts.push(`  id: ${person.id}`);
  return parts.join("\n");
}

function formatContactSummary(contact: Contact): string {
  const parts: string[] = [`- ${contact.displayName ?? "(no name)"}`];

  const emails = contact.emailAddresses?.map((e) => e.address).join(", ");
  if (emails) parts.push(`  Email: ${emails}`);

  if (contact.jobTitle) parts.push(`  Title: ${contact.jobTitle}`);
  if (contact.companyName) parts.push(`  Company: ${contact.companyName}`);

  parts.push(`  id: ${contact.id}`);
  return parts.join("\n");
}

function formatAddress(label: string, addr?: PhysicalAddress): string | undefined {
  if (!addr) return undefined;
  const addrParts = [addr.street, addr.city, addr.state, addr.postalCode, addr.countryOrRegion].filter(Boolean);
  if (addrParts.length === 0) return undefined;
  return `${label}: ${addrParts.join(", ")}`;
}

function formatContactDetail(contact: Contact): string {
  const parts: string[] = [`Name: ${contact.displayName ?? "(no name)"}`];

  if (contact.givenName || contact.surname) {
    parts.push(`  Given name: ${contact.givenName ?? ""} ${contact.surname ?? ""}`.trimEnd());
  }

  const emails = contact.emailAddresses?.map((e) => e.address);
  if (emails && emails.length > 0) parts.push(`  Email: ${emails.join(", ")}`);

  const allPhones: string[] = [];
  if (contact.businessPhones) allPhones.push(...contact.businessPhones.map((p) => `${p} (business)`));
  if (contact.mobilePhone) allPhones.push(`${contact.mobilePhone} (mobile)`);
  if (contact.homePhones) allPhones.push(...contact.homePhones.map((p) => `${p} (home)`));
  if (allPhones.length > 0) parts.push(`  Phone: ${allPhones.join(", ")}`);

  if (contact.jobTitle) parts.push(`  Job title: ${contact.jobTitle}`);
  if (contact.companyName) parts.push(`  Company: ${contact.companyName}`);
  if (contact.department) parts.push(`  Department: ${contact.department}`);
  if (contact.officeLocation) parts.push(`  Office: ${contact.officeLocation}`);

  const homeAddr = formatAddress("Home address", contact.homeAddress);
  if (homeAddr) parts.push(`  ${homeAddr}`);

  const bizAddr = formatAddress("Business address", contact.businessAddress);
  if (bizAddr) parts.push(`  ${bizAddr}`);

  if (contact.personalNotes) parts.push(`  Notes: ${contact.personalNotes}`);
  if (contact.birthday) parts.push(`  Birthday: ${contact.birthday}`);

  parts.push(`  id: ${contact.id}`);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// people_search
// ---------------------------------------------------------------------------

export function peopleSearchTool(): AgentTool {
  return {
    name: "people_search",
    description:
      "Search for people relevant to the current user (colleagues, frequent contacts) using the Microsoft People API. Returns names, emails, phone numbers, job titles, and departments.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query for people (name, email, etc.)." },
        top: { type: "number", description: "Maximum number of results to return (default 25)." },
      },
      required: ["query"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const query = input.query as string | undefined;
      if (!query) return missingParam("query");

      const top = (input.top as number | undefined) ?? 25;

      const odataQuery = buildODataQuery({
        $search: query,
        $top: top,
      });

      const response = await graphRequest<GraphCollectionResponse<Person>>({
        token: context.token,
        path: `/me/people${odataQuery}`,
        headers: {
          ConsistencyLevel: "eventual",
        },
      });

      const people = response.value;
      if (people.length === 0) {
        return { content: `No people found matching "${query}".` };
      }

      const lines = people.map(formatPerson);
      return { content: `Found ${people.length} people:\n${lines.join("\n")}` };
    },
  };
}

// ---------------------------------------------------------------------------
// contacts_list
// ---------------------------------------------------------------------------

export function contactsListTool(): AgentTool {
  return {
    name: "contacts_list",
    description:
      "List the current user's Outlook personal contacts. Shows names, emails, job titles, and companies.",
    inputSchema: {
      type: "object",
      properties: {
        top: { type: "number", description: "Maximum number of contacts to return (default 50)." },
        orderBy: {
          type: "string",
          description: "Field to sort by (e.g. 'displayName', 'givenName', 'surname'). Default: displayName.",
        },
      },
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const top = (input.top as number | undefined) ?? 50;
      const orderBy = (input.orderBy as string | undefined) ?? "displayName";

      const odataQuery = buildODataQuery({
        $top: top,
        $orderby: orderBy,
      });

      const response = await graphRequest<GraphCollectionResponse<Contact>>({
        token: context.token,
        path: `/me/contacts${odataQuery}`,
      });

      const contacts = response.value;
      if (contacts.length === 0) {
        return { content: "No contacts found." };
      }

      const lines = contacts.map(formatContactSummary);
      return { content: `Found ${contacts.length} contact(s):\n${lines.join("\n")}` };
    },
  };
}

// ---------------------------------------------------------------------------
// contacts_read
// ---------------------------------------------------------------------------

export function contactsReadTool(): AgentTool {
  return {
    name: "contacts_read",
    description:
      "Get full details of a specific Outlook contact by ID, including all email addresses, phone numbers, addresses, job title, company, and personal notes.",
    inputSchema: {
      type: "object",
      properties: {
        contactId: { type: "string", description: "The contact ID." },
      },
      required: ["contactId"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const contactId = input.contactId as string | undefined;
      if (!contactId) return missingParam("contactId");

      const contact = await graphRequest<Contact>({
        token: context.token,
        path: `/me/contacts/${contactId}`,
      });

      return { content: formatContactDetail(contact) };
    },
  };
}
