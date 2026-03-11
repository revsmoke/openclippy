import { graphRequest } from "../../graph/client.js";
import type { AgentTool, ToolContext, ToolResult } from "../types.js";
import { missingParam } from "../tool-utils.js";
import type { Presence, PresenceAvailability } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function presenceEmoji(availability: PresenceAvailability): string {
  switch (availability) {
    case "Available":
    case "AvailableIdle":
      return "\u{1F7E2}"; // green circle
    case "Busy":
    case "BusyIdle":
    case "DoNotDisturb":
      return "\u{1F534}"; // red circle
    case "Away":
    case "BeRightBack":
      return "\u{1F7E1}"; // yellow circle
    case "Offline":
      return "\u26AB"; // black circle
    default:
      return "\u2753"; // question mark
  }
}

function formatPresence(presence: Presence): string {
  const emoji = presenceEmoji(presence.availability);
  const lines: string[] = [];

  lines.push(`${emoji} Availability: ${presence.availability}`);
  lines.push(`   Activity: ${presence.activity}`);

  if (presence.statusMessage?.message?.content) {
    lines.push(`   Status: "${presence.statusMessage.message.content}"`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// presence_read
// ---------------------------------------------------------------------------

export function presenceReadTool(): AgentTool {
  return {
    name: "presence_read",
    description:
      "Get the current user's presence (availability and activity) in Microsoft Teams.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    async execute(_input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const presence = await graphRequest<Presence>({
        token: context.token,
        path: "/me/presence",
      });

      return { content: formatPresence(presence) };
    },
  };
}

// ---------------------------------------------------------------------------
// presence_set
// ---------------------------------------------------------------------------

export function presenceSetTool(): AgentTool {
  return {
    name: "presence_set",
    description:
      "Set the current user's preferred presence in Microsoft Teams. " +
      "Availability values: Available, Busy, DoNotDisturb, BeRightBack, Away, Offline. " +
      "Activity should match availability or be a specific activity (InAMeeting, etc.). " +
      "expirationDuration is ISO 8601 duration (e.g. PT1H for 1 hour, PT30M for 30 minutes).",
    inputSchema: {
      type: "object",
      properties: {
        availability: {
          type: "string",
          description:
            "Presence availability to set (Available, Busy, DoNotDisturb, BeRightBack, Away, Offline).",
        },
        activity: {
          type: "string",
          description:
            "Presence activity to set. Should match availability or be a specific activity.",
        },
        expirationDuration: {
          type: "string",
          description:
            "ISO 8601 duration for how long the presence override lasts (e.g. PT1H, PT30M, PT8H).",
        },
      },
      required: ["availability", "activity", "expirationDuration"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const availability = input.availability as string | undefined;
      if (!availability) return missingParam("availability");

      const activity = input.activity as string | undefined;
      if (!activity) return missingParam("activity");

      const expirationDuration = input.expirationDuration as string | undefined;
      if (!expirationDuration) return missingParam("expirationDuration");

      await graphRequest<undefined>({
        token: context.token,
        method: "POST",
        path: "/me/presence/setUserPreferredPresence",
        body: {
          availability,
          activity,
          expirationDuration,
        },
      });

      const emoji = presenceEmoji(availability as PresenceAvailability);
      return {
        content: `${emoji} Presence set to ${availability} (${activity}) for ${expirationDuration}.`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// presence_clear
// ---------------------------------------------------------------------------

export function presenceClearTool(): AgentTool {
  return {
    name: "presence_clear",
    description:
      "Clear the current user's preferred presence override in Microsoft Teams, " +
      "restoring automatic presence detection.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    async execute(_input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      await graphRequest<undefined>({
        token: context.token,
        method: "POST",
        path: "/me/presence/clearUserPreferredPresence",
      });

      return {
        content: "Preferred presence cleared. Teams will now use automatic presence detection.",
      };
    },
  };
}
