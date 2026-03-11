import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calendarListTool,
  calendarReadTool,
  calendarCreateTool,
  calendarUpdateTool,
  calendarDeleteTool,
  calendarAcceptTool,
  calendarDeclineTool,
  calendarFreebusyTool,
} from "./tools.js";
import type { GraphEvent, GraphGetScheduleResponse } from "./types.js";
import { createToolContext } from "../../test-utils/graph-mock.js";

// Mock the graph client module
vi.mock("../../graph/client.js", () => ({
  graphRequest: vi.fn(),
  graphPaginate: vi.fn(),
}));

import { graphRequest, graphPaginate } from "../../graph/client.js";

const mockGraphRequest = vi.mocked(graphRequest);
const mockGraphPaginate = vi.mocked(graphPaginate);

const ctx = createToolContext({
  token: "test-token-abc",
  userId: "user@example.com",
});

const sampleEvent: GraphEvent = {
  id: "evt-001",
  subject: "Team Standup",
  start: { dateTime: "2025-06-15T09:00:00.0000000", timeZone: "America/New_York" },
  end: { dateTime: "2025-06-15T09:30:00.0000000", timeZone: "America/New_York" },
  location: { displayName: "Room 42" },
  attendees: [
    {
      emailAddress: { name: "Alice", address: "alice@example.com" },
      type: "required",
      status: { response: "accepted" },
    },
    {
      emailAddress: { name: "Bob", address: "bob@example.com" },
      type: "optional",
      status: { response: "tentativelyAccepted" },
    },
  ],
  organizer: { emailAddress: { name: "Charlie", address: "charlie@example.com" } },
  isAllDay: false,
  bodyPreview: "Daily standup meeting",
  onlineMeeting: { joinUrl: "https://teams.microsoft.com/meet/123" },
};

const sampleAllDayEvent: GraphEvent = {
  id: "evt-002",
  subject: "Company Holiday",
  start: { dateTime: "2025-12-25T00:00:00.0000000", timeZone: "America/New_York" },
  end: { dateTime: "2025-12-26T00:00:00.0000000", timeZone: "America/New_York" },
  isAllDay: true,
  location: {},
  attendees: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("calendar_list", () => {
  const tool = calendarListTool();

  it("has correct name and schema", () => {
    expect(tool.name).toBe("calendar_list");
    expect(tool.inputSchema).toBeDefined();
  });

  it("fetches events for given date range", async () => {
    mockGraphPaginate.mockResolvedValue([sampleEvent]);

    const result = await tool.execute(
      {
        startDateTime: "2025-06-15T00:00:00",
        endDateTime: "2025-06-16T00:00:00",
      },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("Team Standup");
    expect(result.content).toContain("Room 42");
    expect(mockGraphPaginate).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token-abc",
        path: expect.stringContaining("/me/calendarView"),
      }),
    );
    // Verify startDateTime and endDateTime are in the path (colons are URL-encoded)
    const callPath = mockGraphPaginate.mock.calls[0][0].path;
    expect(callPath).toContain("startDateTime=2025-06-15T00%3A00%3A00");
    expect(callPath).toContain("endDateTime=2025-06-16T00%3A00%3A00");
  });

  it("defaults to today when no dates provided", async () => {
    mockGraphPaginate.mockResolvedValue([]);

    const result = await tool.execute({}, ctx);

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("No events");
    // Should still call Graph API with some date range
    expect(mockGraphPaginate).toHaveBeenCalled();
  });

  it("shows all-day events correctly", async () => {
    mockGraphPaginate.mockResolvedValue([sampleAllDayEvent]);

    const result = await tool.execute(
      { startDateTime: "2025-12-25T00:00:00", endDateTime: "2025-12-26T00:00:00" },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("Company Holiday");
    expect(result.content).toContain("All day");
  });

  it("includes attendees and online meeting link", async () => {
    mockGraphPaginate.mockResolvedValue([sampleEvent]);

    const result = await tool.execute(
      { startDateTime: "2025-06-15T00:00:00", endDateTime: "2025-06-16T00:00:00" },
      ctx,
    );

    expect(result.content).toContain("Alice");
    expect(result.content).toContain("Bob");
    expect(result.content).toContain("https://teams.microsoft.com/meet/123");
  });
});

describe("calendar_read", () => {
  const tool = calendarReadTool();

  it("has correct name", () => {
    expect(tool.name).toBe("calendar_read");
  });

  it("fetches a single event by id", async () => {
    mockGraphRequest.mockResolvedValue(sampleEvent);

    const result = await tool.execute({ eventId: "evt-001" }, ctx);

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("Team Standup");
    expect(result.content).toContain("Room 42");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token-abc",
        path: "/me/events/evt-001",
      }),
    );
  });

  it("returns error when eventId is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("eventId");
  });
});

describe("calendar_create", () => {
  const tool = calendarCreateTool();

  it("has correct name", () => {
    expect(tool.name).toBe("calendar_create");
  });

  it("creates an event with required fields", async () => {
    mockGraphRequest.mockResolvedValue({ ...sampleEvent, id: "new-evt-001" });

    const result = await tool.execute(
      {
        subject: "Team Standup",
        startDateTime: "2025-06-15T09:00:00",
        endDateTime: "2025-06-15T09:30:00",
      },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("created");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/me/events",
        body: expect.objectContaining({
          subject: "Team Standup",
          start: expect.objectContaining({ dateTime: "2025-06-15T09:00:00" }),
          end: expect.objectContaining({ dateTime: "2025-06-15T09:30:00" }),
        }),
      }),
    );
  });

  it("creates an event with all optional fields", async () => {
    mockGraphRequest.mockResolvedValue({ ...sampleEvent, id: "new-evt-002" });

    const result = await tool.execute(
      {
        subject: "All Hands",
        startDateTime: "2025-06-20T14:00:00",
        endDateTime: "2025-06-20T15:00:00",
        location: "Main Auditorium",
        attendees: ["alice@example.com", "bob@example.com"],
        body: "Monthly all-hands meeting",
        isAllDay: false,
      },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    const callBody = mockGraphRequest.mock.calls[0][0].body as Record<string, unknown>;
    expect(callBody.location).toEqual({ displayName: "Main Auditorium" });
    expect(callBody.body).toEqual({ contentType: "text", content: "Monthly all-hands meeting" });
    expect(callBody.attendees).toEqual([
      { emailAddress: { address: "alice@example.com" }, type: "required" },
      { emailAddress: { address: "bob@example.com" }, type: "required" },
    ]);
  });

  it("creates an all-day event", async () => {
    mockGraphRequest.mockResolvedValue({ ...sampleAllDayEvent, id: "new-evt-003" });

    const result = await tool.execute(
      {
        subject: "Company Holiday",
        startDateTime: "2025-12-25",
        endDateTime: "2025-12-26",
        isAllDay: true,
      },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    const callBody = mockGraphRequest.mock.calls[0][0].body as Record<string, unknown>;
    expect(callBody.isAllDay).toBe(true);
  });

  it("returns error when subject is missing", async () => {
    const result = await tool.execute(
      { startDateTime: "2025-06-15T09:00:00", endDateTime: "2025-06-15T09:30:00" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("subject");
  });

  it("returns error when startDateTime is missing", async () => {
    const result = await tool.execute(
      { subject: "Test", endDateTime: "2025-06-15T09:30:00" },
      ctx,
    );

    expect(result.isError).toBe(true);
  });

  it("returns error when endDateTime is missing", async () => {
    const result = await tool.execute(
      { subject: "Test", startDateTime: "2025-06-15T09:00:00" },
      ctx,
    );

    expect(result.isError).toBe(true);
  });
});

describe("calendar_update", () => {
  const tool = calendarUpdateTool();

  it("has correct name", () => {
    expect(tool.name).toBe("calendar_update");
  });

  it("updates an event with new subject and time", async () => {
    mockGraphRequest.mockResolvedValue({
      ...sampleEvent,
      subject: "Updated Standup",
    });

    const result = await tool.execute(
      {
        eventId: "evt-001",
        subject: "Updated Standup",
        startDateTime: "2025-06-15T10:00:00",
        endDateTime: "2025-06-15T10:30:00",
      },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("updated");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        path: "/me/events/evt-001",
        body: expect.objectContaining({
          subject: "Updated Standup",
        }),
      }),
    );
  });

  it("updates only provided fields", async () => {
    mockGraphRequest.mockResolvedValue({ ...sampleEvent, subject: "New Subject" });

    await tool.execute({ eventId: "evt-001", subject: "New Subject" }, ctx);

    const callBody = mockGraphRequest.mock.calls[0][0].body as Record<string, unknown>;
    expect(callBody.subject).toBe("New Subject");
    expect(callBody.start).toBeUndefined();
    expect(callBody.end).toBeUndefined();
  });

  it("returns error when eventId is missing", async () => {
    const result = await tool.execute({ subject: "Test" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("eventId");
  });
});

describe("calendar_delete", () => {
  const tool = calendarDeleteTool();

  it("has correct name", () => {
    expect(tool.name).toBe("calendar_delete");
  });

  it("deletes an event by id", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await tool.execute({ eventId: "evt-001" }, ctx);

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("deleted");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: "/me/events/evt-001",
      }),
    );
  });

  it("returns error when eventId is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("eventId");
  });
});

describe("calendar_accept", () => {
  const tool = calendarAcceptTool();

  it("has correct name", () => {
    expect(tool.name).toBe("calendar_accept");
  });

  it("accepts a meeting invitation", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await tool.execute({ eventId: "evt-001" }, ctx);

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("accepted");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/me/events/evt-001/accept",
        body: expect.objectContaining({ sendResponse: true }),
      }),
    );
  });

  it("accepts with optional comment", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    await tool.execute(
      { eventId: "evt-001", comment: "Looking forward to it!" },
      ctx,
    );

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          sendResponse: true,
          comment: "Looking forward to it!",
        }),
      }),
    );
  });

  it("returns error when eventId is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("eventId");
  });
});

describe("calendar_decline", () => {
  const tool = calendarDeclineTool();

  it("has correct name", () => {
    expect(tool.name).toBe("calendar_decline");
  });

  it("declines a meeting invitation", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await tool.execute({ eventId: "evt-001" }, ctx);

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("declined");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/me/events/evt-001/decline",
        body: expect.objectContaining({ sendResponse: true }),
      }),
    );
  });

  it("declines with optional comment", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    await tool.execute(
      { eventId: "evt-001", comment: "Conflict with another meeting" },
      ctx,
    );

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          sendResponse: true,
          comment: "Conflict with another meeting",
        }),
      }),
    );
  });

  it("returns error when eventId is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("eventId");
  });
});

describe("calendar_freebusy", () => {
  const tool = calendarFreebusyTool();

  it("has correct name", () => {
    expect(tool.name).toBe("calendar_freebusy");
  });

  it("checks free/busy for given schedules", async () => {
    const scheduleResponse: GraphGetScheduleResponse = {
      value: [
        {
          scheduleId: "alice@example.com",
          availabilityView: "0012000",
          scheduleItems: [
            {
              status: "busy",
              subject: "Meeting",
              start: { dateTime: "2025-06-15T10:00:00", timeZone: "UTC" },
              end: { dateTime: "2025-06-15T11:00:00", timeZone: "UTC" },
            },
          ],
        },
      ],
    };
    mockGraphRequest.mockResolvedValue(scheduleResponse);

    const result = await tool.execute(
      {
        schedules: ["alice@example.com"],
        startDateTime: "2025-06-15T08:00:00",
        endDateTime: "2025-06-15T17:00:00",
      },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("alice@example.com");
    expect(result.content).toContain("busy");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/me/calendar/getSchedule",
        body: expect.objectContaining({
          schedules: ["alice@example.com"],
        }),
      }),
    );
  });

  it("returns error when schedules is missing", async () => {
    const result = await tool.execute(
      {
        startDateTime: "2025-06-15T08:00:00",
        endDateTime: "2025-06-15T17:00:00",
      },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("schedules");
  });

  it("returns error when startDateTime is missing", async () => {
    const result = await tool.execute(
      { schedules: ["alice@example.com"], endDateTime: "2025-06-15T17:00:00" },
      ctx,
    );

    expect(result.isError).toBe(true);
  });

  it("returns error when endDateTime is missing", async () => {
    const result = await tool.execute(
      { schedules: ["alice@example.com"], startDateTime: "2025-06-15T08:00:00" },
      ctx,
    );

    expect(result.isError).toBe(true);
  });

  it("handles multiple schedules", async () => {
    const scheduleResponse: GraphGetScheduleResponse = {
      value: [
        {
          scheduleId: "alice@example.com",
          availabilityView: "0000000",
          scheduleItems: [],
        },
        {
          scheduleId: "bob@example.com",
          availabilityView: "0012000",
          scheduleItems: [
            {
              status: "busy",
              start: { dateTime: "2025-06-15T10:00:00", timeZone: "UTC" },
              end: { dateTime: "2025-06-15T11:00:00", timeZone: "UTC" },
            },
          ],
        },
      ],
    };
    mockGraphRequest.mockResolvedValue(scheduleResponse);

    const result = await tool.execute(
      {
        schedules: ["alice@example.com", "bob@example.com"],
        startDateTime: "2025-06-15T08:00:00",
        endDateTime: "2025-06-15T17:00:00",
      },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("alice@example.com");
    expect(result.content).toContain("bob@example.com");
  });
});
