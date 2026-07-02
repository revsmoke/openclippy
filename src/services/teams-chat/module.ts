import type { ServiceModule } from "../types.js";
import {
  teamsListTool,
  teamsListChatsTool,
  teamsReadChatTool,
  teamsSendTool,
  teamsListChannelsTool,
  teamsChannelMessagesTool,
  teamsSendChannelTool,
} from "./tools.js";

/**
 * Microsoft Teams Chat service module.
 *
 * Exposes tools for reading and sending messages in Teams 1:1/group chats
 * and team channels via the Microsoft Graph API.
 */
export const teamsChatModule: ServiceModule = {
  id: "teams-chat",

  meta: {
    label: "Teams Chat",
    description:
      "Read and send messages in Microsoft Teams chats and channels",
    requiredScopes: [
      "Chat.Read",
      "ChatMessage.Send",
      "Channel.ReadBasic.All",
      "ChannelMessage.Read.All",
      "ChannelMessage.Send",
      "Team.ReadBasic.All",
    ],
  },

  capabilities: {
    read: true,
    write: true,
    delete: false,
    search: false,
    subscribe: false,
  },

  tools: () => [
    teamsListTool(),
    teamsListChatsTool(),
    teamsReadChatTool(),
    teamsSendTool(),
    teamsListChannelsTool(),
    teamsChannelMessagesTool(),
    teamsSendChannelTool(),
  ],

  promptHints: () => [
    "Use teams_list to discover the team ids of the teams the user belongs to.",
    "Use teams_chats_list to discover chat ids before reading or sending messages.",
    "Use teams_channels_list with a teamId to find channel ids before reading or posting to channels.",
  ],
};
