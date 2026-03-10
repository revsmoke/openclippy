import type { ServiceModule } from "../types.js";
import {
  todoListsTool,
  todoTasksTool,
  todoCreateTool,
  todoUpdateTool,
  todoCompleteTool,
  todoDeleteTool,
} from "./tools.js";

/**
 * Microsoft To Do service module.
 *
 * Exposes 6 tools for managing To Do task lists and tasks via the
 * Microsoft Graph API.
 */
export const todoModule: ServiceModule = {
  id: "todo",

  meta: {
    label: "To Do",
    description: "Microsoft To Do task management — lists, tasks, create, update, complete, delete.",
    requiredScopes: ["Tasks.Read"],
    optionalScopes: ["Tasks.ReadWrite"],
  },

  capabilities: {
    read: true,
    write: true,
    delete: true,
    search: false,
    subscribe: false,
  },

  tools: () => [
    todoListsTool(),
    todoTasksTool(),
    todoCreateTool(),
    todoUpdateTool(),
    todoCompleteTool(),
    todoDeleteTool(),
  ],

  promptHints: () => [
    "To Do lists can be fetched with todo_lists, then use the list ID for task operations.",
    "Use todo_complete as a shortcut to mark tasks done instead of todo_update with status.",
  ],
};
