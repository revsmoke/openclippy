import type { ServiceModule } from "../types.js";
import { getErrorMessage } from "../tool-utils.js";
import { graphRequest } from "../../graph/client.js";
import type { GraphCollectionResponse } from "../../graph/client.js";
import type { GraphMessage } from "./types.js";
import {
  mailListTool,
  mailReadTool,
  mailSearchTool,
  mailSendTool,
  mailDraftTool,
  mailReplyTool,
  mailForwardTool,
  mailMoveTool,
  mailFlagTool,
  mailDeleteTool,
  mailFoldersTool,
} from "./tools.js";

export const mailModule: ServiceModule = {
  id: "mail",

  meta: {
    label: "Outlook Mail",
    description: "Read, send, search, and manage Outlook emails",
    requiredScopes: ["Mail.Read"],
    optionalScopes: ["Mail.ReadWrite", "Mail.Send"],
  },

  capabilities: {
    read: true,
    write: true,
    delete: true,
    search: true,
    subscribe: true,
  },

  tools: () => [
    mailListTool(),
    mailReadTool(),
    mailSearchTool(),
    mailSendTool(),
    mailDraftTool(),
    mailReplyTool(),
    mailForwardTool(),
    mailMoveTool(),
    mailFlagTool(),
    mailDeleteTool(),
    mailFoldersTool(),
  ],

  status: {
    probe: async ({ token }) => {
      try {
        await graphRequest<GraphCollectionResponse<GraphMessage>>({
          token,
          path: "/me/messages?$top=1&$select=id",
        });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: getErrorMessage(err),
        };
      }
    },
  },

  subscriptions: {
    resources: ["/me/messages"],
    changeTypes: ["created", "updated", "deleted"],
    handle: async (_notification) => {
      // Placeholder: subscription handling will be implemented when
      // the notification infrastructure is ready.
    },
  },

  promptHints: () => [
    "User has Outlook Mail access. Can read, search, send, reply, forward, flag, move, and delete emails.",
  ],
};
