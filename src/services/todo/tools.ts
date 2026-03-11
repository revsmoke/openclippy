import { graphRequest } from "../../graph/client.js";
import type { GraphCollectionResponse } from "../../graph/client.js";
import { buildODataQuery } from "../../graph/types.js";
import type { AgentTool, ToolContext, ToolResult } from "../types.js";
import { missingParam } from "../tool-utils.js";
import type { TodoTask, TodoTaskList, TaskStatus, TaskImportance, DateTimeTimeZone } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDueDate(dt?: DateTimeTimeZone): string {
  if (!dt) return "none";
  return dt.dateTime.split("T")[0] ?? dt.dateTime;
}

function formatTask(task: TodoTask): string {
  const status = task.status === "completed" ? "[x]" : "[ ]";
  const due = task.dueDateTime ? ` (due: ${formatDueDate(task.dueDateTime)})` : "";
  const imp = task.importance !== "normal" ? ` [${task.importance}]` : "";
  return `${status} ${task.title}${due}${imp} — id: ${task.id}`;
}

// ---------------------------------------------------------------------------
// todo_lists
// ---------------------------------------------------------------------------

export function todoListsTool(): AgentTool {
  return {
    name: "todo_lists",
    description: "List all Microsoft To Do task lists for the current user.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    async execute(_input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const response = await graphRequest<GraphCollectionResponse<TodoTaskList>>({
        token: context.token,
        path: "/me/todo/lists",
      });

      const lists = response.value;
      if (lists.length === 0) {
        return { content: "No task lists found." };
      }

      const lines = lists.map(
        (l) => `- ${l.displayName} (id: ${l.id})${l.wellknownListName !== "none" ? ` [${l.wellknownListName}]` : ""}`,
      );
      return { content: `Found ${lists.length} task list(s):\n${lines.join("\n")}` };
    },
  };
}

// ---------------------------------------------------------------------------
// todo_tasks
// ---------------------------------------------------------------------------

export function todoTasksTool(): AgentTool {
  return {
    name: "todo_tasks",
    description:
      "List tasks in a Microsoft To Do list. Optionally filter by status (notStarted, inProgress, completed, waitingOnOthers, deferred).",
    inputSchema: {
      type: "object",
      properties: {
        listId: { type: "string", description: "The task list ID." },
        status: {
          type: "string",
          description: "Optional filter by task status.",
          enum: ["notStarted", "inProgress", "completed", "waitingOnOthers", "deferred"],
        },
      },
      required: ["listId"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const listId = input.listId as string | undefined;
      if (!listId) return missingParam("listId");

      const status = input.status as TaskStatus | undefined;

      const query = buildODataQuery({
        $filter: status ? `status eq '${status}'` : undefined,
        $orderby: "createdDateTime desc",
        $top: 50,
      });

      const response = await graphRequest<GraphCollectionResponse<TodoTask>>({
        token: context.token,
        path: `/me/todo/lists/${listId}/tasks${query}`,
      });

      const tasks = response.value;
      if (tasks.length === 0) {
        return { content: status ? `No tasks with status '${status}' found.` : "No tasks found in this list." };
      }

      const lines = tasks.map(formatTask);
      return { content: `Found ${tasks.length} task(s):\n${lines.join("\n")}` };
    },
  };
}

// ---------------------------------------------------------------------------
// todo_create
// ---------------------------------------------------------------------------

export function todoCreateTool(): AgentTool {
  return {
    name: "todo_create",
    description: "Create a new task in a Microsoft To Do list.",
    inputSchema: {
      type: "object",
      properties: {
        listId: { type: "string", description: "The task list ID." },
        title: { type: "string", description: "Task title (required)." },
        body: { type: "string", description: "Optional task body/notes." },
        dueDateTime: {
          type: "string",
          description: "Optional due date in YYYY-MM-DD format.",
        },
        importance: {
          type: "string",
          description: "Optional importance level.",
          enum: ["low", "normal", "high"],
        },
      },
      required: ["listId", "title"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const listId = input.listId as string | undefined;
      if (!listId) return missingParam("listId");

      const title = input.title as string | undefined;
      if (!title) return missingParam("title");

      const body: Record<string, unknown> = { title };

      if (input.body) {
        body.body = { content: input.body as string, contentType: "text" };
      }

      if (input.dueDateTime) {
        const tz = context.timezone ?? "UTC";
        body.dueDateTime = {
          dateTime: `${input.dueDateTime as string}T00:00:00`,
          timeZone: tz,
        };
      }

      if (input.importance) {
        body.importance = input.importance as TaskImportance;
      }

      const task = await graphRequest<TodoTask>({
        token: context.token,
        path: `/me/todo/lists/${listId}/tasks`,
        method: "POST",
        body,
      });

      return {
        content: `Task created: "${task.title}" (id: ${task.id})${task.dueDateTime ? ` due ${formatDueDate(task.dueDateTime)}` : ""}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// todo_update
// ---------------------------------------------------------------------------

export function todoUpdateTool(): AgentTool {
  return {
    name: "todo_update",
    description: "Update properties of an existing Microsoft To Do task (title, body, importance, dueDateTime).",
    inputSchema: {
      type: "object",
      properties: {
        listId: { type: "string", description: "The task list ID." },
        taskId: { type: "string", description: "The task ID." },
        title: { type: "string", description: "New task title." },
        body: { type: "string", description: "New task body/notes." },
        importance: {
          type: "string",
          description: "New importance level.",
          enum: ["low", "normal", "high"],
        },
        dueDateTime: {
          type: "string",
          description: "New due date in YYYY-MM-DD format.",
        },
      },
      required: ["listId", "taskId"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const listId = input.listId as string | undefined;
      if (!listId) return missingParam("listId");

      const taskId = input.taskId as string | undefined;
      if (!taskId) return missingParam("taskId");

      const patch: Record<string, unknown> = {};

      if (input.title) patch.title = input.title as string;
      if (input.body) patch.body = { content: input.body as string, contentType: "text" };
      if (input.importance) patch.importance = input.importance as TaskImportance;
      if (input.dueDateTime) {
        const tz = context.timezone ?? "UTC";
        patch.dueDateTime = {
          dateTime: `${input.dueDateTime as string}T00:00:00`,
          timeZone: tz,
        };
      }

      if (Object.keys(patch).length === 0) {
        return { content: "No properties to update. Provide at least one of: title, body, importance, dueDateTime.", isError: true };
      }

      const task = await graphRequest<TodoTask>({
        token: context.token,
        path: `/me/todo/lists/${listId}/tasks/${taskId}`,
        method: "PATCH",
        body: patch,
      });

      return { content: `Task updated: "${task.title}" (id: ${task.id})` };
    },
  };
}

// ---------------------------------------------------------------------------
// todo_complete
// ---------------------------------------------------------------------------

export function todoCompleteTool(): AgentTool {
  return {
    name: "todo_complete",
    description: "Mark a Microsoft To Do task as completed.",
    inputSchema: {
      type: "object",
      properties: {
        listId: { type: "string", description: "The task list ID." },
        taskId: { type: "string", description: "The task ID." },
      },
      required: ["listId", "taskId"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const listId = input.listId as string | undefined;
      if (!listId) return missingParam("listId");

      const taskId = input.taskId as string | undefined;
      if (!taskId) return missingParam("taskId");

      const task = await graphRequest<TodoTask>({
        token: context.token,
        path: `/me/todo/lists/${listId}/tasks/${taskId}`,
        method: "PATCH",
        body: { status: "completed" },
      });

      return { content: `Task "${task.title}" marked as completed.` };
    },
  };
}

// ---------------------------------------------------------------------------
// todo_delete
// ---------------------------------------------------------------------------

export function todoDeleteTool(): AgentTool {
  return {
    name: "todo_delete",
    description: "Delete a Microsoft To Do task.",
    inputSchema: {
      type: "object",
      properties: {
        listId: { type: "string", description: "The task list ID." },
        taskId: { type: "string", description: "The task ID." },
      },
      required: ["listId", "taskId"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const listId = input.listId as string | undefined;
      if (!listId) return missingParam("listId");

      const taskId = input.taskId as string | undefined;
      if (!taskId) return missingParam("taskId");

      await graphRequest<undefined>({
        token: context.token,
        path: `/me/todo/lists/${listId}/tasks/${taskId}`,
        method: "DELETE",
      });

      return { content: `Task ${taskId} deleted.` };
    },
  };
}
