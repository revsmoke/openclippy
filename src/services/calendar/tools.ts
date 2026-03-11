import { graphRequest, graphPaginate } from "../../graph/client.js";
import type { AgentTool, ToolContext, ToolResult } from "../types.js";
import { requireString, requireArray } from "../tool-utils.js";
import type {
  GraphEvent,
  GraphGetScheduleResponse,
  GraphAttendee,
  GraphScheduleInformation,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get today's start and end as ISO strings in the user's timezone (fallback UTC). */
function todayRange(timezone?: string): { start: string; end: string } {
  const tz = timezone ?? "UTC";
  const now = new Date();
  // Build date string in the user's timezone
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dateStr = formatter.format(now); // "YYYY-MM-DD"
  return {
    start: `${dateStr}T00:00:00`,
    end: `${dateStr}T23:59:59`,
  };
}

/** Format a Graph dateTime + timeZone pair into a human-friendly string. */
function formatDateTime(
  dt: { dateTime: string; timeZone: string } | undefined,
  isAllDay: boolean,
): string {
  if (!dt) return "N/A";
  if (isAllDay) return "All day";
  try {
    const d = new Date(dt.dateTime + (dt.dateTime.endsWith("Z") ? "" : "Z"));
    // If the timezone looks reasonable, format with it
    return d.toLocaleString("en-US", {
      timeZone: dt.timeZone || "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return dt.dateTime;
  }
}

/** Format a single event into a human-readable block. */
function formatEvent(evt: GraphEvent): string {
  const isAllDay = evt.isAllDay ?? false;
  const lines: string[] = [];

  lines.push(`**${evt.subject ?? "(No subject)"}**`);

  if (isAllDay) {
    lines.push(`  Time: All day`);
  } else {
    const start = formatDateTime(evt.start, false);
    const end = formatDateTime(evt.end, false);
    lines.push(`  Time: ${start} - ${end}`);
  }

  if (evt.location?.displayName) {
    lines.push(`  Location: ${evt.location.displayName}`);
  }

  if (evt.attendees && evt.attendees.length > 0) {
    const list = evt.attendees
      .map((a) => {
        const name = a.emailAddress.name || a.emailAddress.address;
        const response = a.status?.response ?? "none";
        return `${name} (${response})`;
      })
      .join(", ");
    lines.push(`  Attendees: ${list}`);
  }

  if (evt.organizer?.emailAddress) {
    const org = evt.organizer.emailAddress.name || evt.organizer.emailAddress.address;
    lines.push(`  Organizer: ${org}`);
  }

  const joinUrl = evt.onlineMeeting?.joinUrl ?? evt.onlineMeetingUrl;
  if (joinUrl) {
    lines.push(`  Online: ${joinUrl}`);
  }

  if (evt.bodyPreview) {
    lines.push(`  Preview: ${evt.bodyPreview.slice(0, 200)}`);
  }

  lines.push(`  ID: ${evt.id}`);
  return lines.join("\n");
}

/** Format schedule information into a human-readable block. */
function formatSchedule(info: GraphScheduleInformation): string {
  const lines: string[] = [];
  lines.push(`**${info.scheduleId}**`);

  if (info.error) {
    lines.push(`  Error: ${info.error.message}`);
    return lines.join("\n");
  }

  if (info.scheduleItems.length === 0) {
    lines.push("  Status: Free (no events in this period)");
  } else {
    for (const item of info.scheduleItems) {
      const start = formatDateTime(item.start, false);
      const end = formatDateTime(item.end, false);
      const subj = item.subject ? ` — ${item.subject}` : "";
      lines.push(`  ${item.status}: ${start} - ${end}${subj}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// calendar_list
// ---------------------------------------------------------------------------

export function calendarListTool(): AgentTool {
  return {
    name: "calendar_list",
    description:
      "List calendar events in a date range. Defaults to today if no range specified.",
    inputSchema: {
      type: "object",
      properties: {
        startDateTime: {
          type: "string",
          description: "Start of range (ISO 8601). Defaults to start of today.",
        },
        endDateTime: {
          type: "string",
          description: "End of range (ISO 8601). Defaults to end of today.",
        },
        top: {
          type: "number",
          description: "Max number of events to return (default 25).",
        },
      },
    },
    async execute(input, ctx) {
      const defaults = todayRange(ctx.timezone);
      const startDT =
        typeof input.startDateTime === "string" && input.startDateTime
          ? input.startDateTime
          : defaults.start;
      const endDT =
        typeof input.endDateTime === "string" && input.endDateTime
          ? input.endDateTime
          : defaults.end;
      const top = typeof input.top === "number" ? input.top : 25;

      const path = `/me/calendarView?startDateTime=${encodeURIComponent(startDT)}&endDateTime=${encodeURIComponent(endDT)}&$top=${top}&$orderby=start/dateTime`;

      const events = await graphPaginate<GraphEvent>({
        token: ctx.token,
        path,
        maxPages: 3,
      });

      if (events.length === 0) {
        return { content: "No events found in the specified time range." };
      }

      const formatted = events.map(formatEvent).join("\n\n");
      return {
        content: `Found ${events.length} event(s):\n\n${formatted}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// calendar_read
// ---------------------------------------------------------------------------

export function calendarReadTool(): AgentTool {
  return {
    name: "calendar_read",
    description: "Get full details of a single calendar event by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: {
          type: "string",
          description: "The event ID to retrieve.",
        },
      },
      required: ["eventId"],
    },
    async execute(input, ctx) {
      const eventId = requireString(input, "eventId");
      if (typeof eventId !== "string") return eventId;

      const evt = await graphRequest<GraphEvent>({
        token: ctx.token,
        path: `/me/events/${eventId}`,
      });

      return { content: formatEvent(evt) };
    },
  };
}

// ---------------------------------------------------------------------------
// calendar_create
// ---------------------------------------------------------------------------

export function calendarCreateTool(): AgentTool {
  return {
    name: "calendar_create",
    description:
      "Create a new calendar event. Requires subject, start, and end times.",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Event subject/title." },
        startDateTime: {
          type: "string",
          description: "Start time in ISO 8601 format.",
        },
        endDateTime: {
          type: "string",
          description: "End time in ISO 8601 format.",
        },
        location: { type: "string", description: "Location name." },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "List of attendee email addresses.",
        },
        body: { type: "string", description: "Event body/description." },
        isAllDay: { type: "boolean", description: "Whether this is an all-day event." },
      },
      required: ["subject", "startDateTime", "endDateTime"],
    },
    async execute(input, ctx) {
      const subject = requireString(input, "subject");
      if (typeof subject !== "string") return subject;

      const startDT = requireString(input, "startDateTime");
      if (typeof startDT !== "string") return startDT;

      const endDT = requireString(input, "endDateTime");
      if (typeof endDT !== "string") return endDT;

      const tz = ctx.timezone ?? "UTC";
      const isAllDay = input.isAllDay === true;

      const payload: Record<string, unknown> = {
        subject,
        start: { dateTime: startDT, timeZone: tz },
        end: { dateTime: endDT, timeZone: tz },
        isAllDay,
      };

      if (typeof input.location === "string" && input.location) {
        payload.location = { displayName: input.location };
      }

      if (typeof input.body === "string" && input.body) {
        payload.body = { contentType: "text", content: input.body };
      }

      if (Array.isArray(input.attendees) && input.attendees.length > 0) {
        payload.attendees = (input.attendees as string[]).map(
          (email): GraphAttendee => ({
            emailAddress: { address: email },
            type: "required",
          }),
        );
      }

      const evt = await graphRequest<GraphEvent>({
        token: ctx.token,
        path: "/me/events",
        method: "POST",
        body: payload,
      });

      return {
        content: `Event created successfully.\n\n${formatEvent(evt)}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// calendar_update
// ---------------------------------------------------------------------------

export function calendarUpdateTool(): AgentTool {
  return {
    name: "calendar_update",
    description: "Update an existing calendar event. Only sends changed fields.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID to update." },
        subject: { type: "string", description: "New subject." },
        startDateTime: { type: "string", description: "New start time (ISO 8601)." },
        endDateTime: { type: "string", description: "New end time (ISO 8601)." },
        location: { type: "string", description: "New location name." },
        body: { type: "string", description: "New body content." },
        isAllDay: { type: "boolean", description: "Whether all-day." },
      },
      required: ["eventId"],
    },
    async execute(input, ctx) {
      const eventId = requireString(input, "eventId");
      if (typeof eventId !== "string") return eventId;

      const tz = ctx.timezone ?? "UTC";
      const payload: Record<string, unknown> = {};

      if (typeof input.subject === "string") payload.subject = input.subject;
      if (typeof input.startDateTime === "string") {
        payload.start = { dateTime: input.startDateTime, timeZone: tz };
      }
      if (typeof input.endDateTime === "string") {
        payload.end = { dateTime: input.endDateTime, timeZone: tz };
      }
      if (typeof input.location === "string") {
        payload.location = { displayName: input.location };
      }
      if (typeof input.body === "string") {
        payload.body = { contentType: "text", content: input.body };
      }
      if (typeof input.isAllDay === "boolean") {
        payload.isAllDay = input.isAllDay;
      }

      const evt = await graphRequest<GraphEvent>({
        token: ctx.token,
        path: `/me/events/${eventId}`,
        method: "PATCH",
        body: payload,
      });

      return {
        content: `Event updated successfully.\n\n${formatEvent(evt)}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// calendar_delete
// ---------------------------------------------------------------------------

export function calendarDeleteTool(): AgentTool {
  return {
    name: "calendar_delete",
    description: "Delete a calendar event by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID to delete." },
      },
      required: ["eventId"],
    },
    async execute(input, ctx) {
      const eventId = requireString(input, "eventId");
      if (typeof eventId !== "string") return eventId;

      await graphRequest<void>({
        token: ctx.token,
        path: `/me/events/${eventId}`,
        method: "DELETE",
      });

      return { content: `Event ${eventId} deleted successfully.` };
    },
  };
}

// ---------------------------------------------------------------------------
// calendar_accept
// ---------------------------------------------------------------------------

export function calendarAcceptTool(): AgentTool {
  return {
    name: "calendar_accept",
    description:
      "Accept a meeting invitation. Sends response to organizer by default.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID to accept." },
        comment: {
          type: "string",
          description: "Optional comment to include with the response.",
        },
        sendResponse: {
          type: "boolean",
          description: "Whether to send a response to the organizer (default true).",
        },
      },
      required: ["eventId"],
    },
    async execute(input, ctx) {
      const eventId = requireString(input, "eventId");
      if (typeof eventId !== "string") return eventId;

      const body: Record<string, unknown> = {
        sendResponse: input.sendResponse !== false,
      };
      if (typeof input.comment === "string") {
        body.comment = input.comment;
      }

      await graphRequest<void>({
        token: ctx.token,
        path: `/me/events/${eventId}/accept`,
        method: "POST",
        body,
      });

      return { content: `Meeting invitation accepted for event ${eventId}.` };
    },
  };
}

// ---------------------------------------------------------------------------
// calendar_decline
// ---------------------------------------------------------------------------

export function calendarDeclineTool(): AgentTool {
  return {
    name: "calendar_decline",
    description:
      "Decline a meeting invitation. Sends response to organizer by default.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID to decline." },
        comment: {
          type: "string",
          description: "Optional comment to include with the response.",
        },
        sendResponse: {
          type: "boolean",
          description: "Whether to send a response to the organizer (default true).",
        },
      },
      required: ["eventId"],
    },
    async execute(input, ctx) {
      const eventId = requireString(input, "eventId");
      if (typeof eventId !== "string") return eventId;

      const body: Record<string, unknown> = {
        sendResponse: input.sendResponse !== false,
      };
      if (typeof input.comment === "string") {
        body.comment = input.comment;
      }

      await graphRequest<void>({
        token: ctx.token,
        path: `/me/events/${eventId}/decline`,
        method: "POST",
        body,
      });

      return { content: `Meeting invitation declined for event ${eventId}.` };
    },
  };
}

// ---------------------------------------------------------------------------
// calendar_freebusy
// ---------------------------------------------------------------------------

export function calendarFreebusyTool(): AgentTool {
  return {
    name: "calendar_freebusy",
    description:
      "Check free/busy availability for one or more people in a time range.",
    inputSchema: {
      type: "object",
      properties: {
        schedules: {
          type: "array",
          items: { type: "string" },
          description: "Email addresses to check availability for.",
        },
        startDateTime: {
          type: "string",
          description: "Start of the time range (ISO 8601).",
        },
        endDateTime: {
          type: "string",
          description: "End of the time range (ISO 8601).",
        },
        availabilityViewInterval: {
          type: "number",
          description: "Duration of each time slot in minutes (default 30).",
        },
      },
      required: ["schedules", "startDateTime", "endDateTime"],
    },
    async execute(input, ctx) {
      const schedules = requireArray(input, "schedules");
      if (!Array.isArray(schedules)) return schedules;

      const startDT = requireString(input, "startDateTime");
      if (typeof startDT !== "string") return startDT;

      const endDT = requireString(input, "endDateTime");
      if (typeof endDT !== "string") return endDT;

      const tz = ctx.timezone ?? "UTC";

      const body: Record<string, unknown> = {
        schedules,
        startTime: { dateTime: startDT, timeZone: tz },
        endTime: { dateTime: endDT, timeZone: tz },
      };

      if (typeof input.availabilityViewInterval === "number") {
        body.availabilityViewInterval = input.availabilityViewInterval;
      }

      const response = await graphRequest<GraphGetScheduleResponse>({
        token: ctx.token,
        path: "/me/calendar/getSchedule",
        method: "POST",
        body,
      });

      if (!response.value || response.value.length === 0) {
        return { content: "No schedule information returned." };
      }

      const formatted = response.value.map(formatSchedule).join("\n\n");
      return {
        content: `Schedule availability:\n\n${formatted}`,
      };
    },
  };
}
