import { graphRequest } from "../../graph/client.js";
import type { GraphCollectionResponse } from "../../graph/client.js";
import type { AgentTool, ToolContext, ToolResult } from "../types.js";
import type {
  PlannerPlan,
  PlannerTask,
  PlannerBucket,
  PlannerTaskWithDetails,
  PlannerChecklistItem,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function missingParam(name: string): ToolResult {
  return { content: `Missing required parameter: ${name}`, isError: true };
}

/** Map Planner priority integer to human-readable label */
function priorityLabel(priority: number): string {
  switch (priority) {
    case 0: return "Urgent";
    case 1: return "Important";
    case 5: return "Medium";
    case 9: return "Low";
    default: return `Priority ${priority}`;
  }
}

/** Map percentComplete to a status string */
function statusLabel(percentComplete: number): string {
  if (percentComplete === 0) return "Not started";
  if (percentComplete === 100) return "Complete";
  return "In progress";
}

/** Format a date string to YYYY-MM-DD */
function formatDate(dt?: string): string | undefined {
  if (!dt) return undefined;
  return dt.split("T")[0];
}

function formatPlan(plan: PlannerPlan): string {
  const parts: string[] = [`- ${plan.title}`];

  const createdBy = plan.createdBy?.user?.displayName;
  if (createdBy) parts.push(`  Owner: ${createdBy}`);
  else if (plan.owner) parts.push(`  Owner: ${plan.owner}`);

  if (plan.container) parts.push(`  Container: ${plan.container.type} (${plan.container.containerId})`);
  if (plan.createdDateTime) parts.push(`  Created: ${formatDate(plan.createdDateTime)}`);

  parts.push(`  id: ${plan.id}`);
  return parts.join("\n");
}

function formatTaskSummary(task: PlannerTask): string {
  const status = statusLabel(task.percentComplete);
  const priority = priorityLabel(task.priority);
  const due = task.dueDateTime ? ` (due: ${formatDate(task.dueDateTime)})` : "";

  const parts: string[] = [`- ${task.title}`];
  parts.push(`  Status: ${status} | Priority: ${priority}${due}`);

  if (task.bucketId) parts.push(`  Bucket: ${task.bucketId}`);

  parts.push(`  id: ${task.id}`);
  return parts.join("\n");
}

function formatTaskDetail(task: PlannerTaskWithDetails): string {
  const parts: string[] = [`Title: ${task.title}`];

  parts.push(`Status: ${statusLabel(task.percentComplete)} (${task.percentComplete}%)`);
  parts.push(`Priority: ${priorityLabel(task.priority)}`);

  if (task.startDateTime) parts.push(`Start: ${formatDate(task.startDateTime)}`);
  if (task.dueDateTime) parts.push(`Due: ${formatDate(task.dueDateTime)}`);
  if (task.completedDateTime) parts.push(`Completed: ${formatDate(task.completedDateTime)}`);

  if (task.bucketId) parts.push(`Bucket: ${task.bucketId}`);
  if (task.planId) parts.push(`Plan: ${task.planId}`);

  if (task.assignments && Object.keys(task.assignments).length > 0) {
    parts.push(`Assigned to: ${Object.keys(task.assignments).join(", ")}`);
  }

  if (task.details?.description) {
    parts.push(`\nDescription:\n${task.details.description}`);
  }

  if (task.details?.checklist && Object.keys(task.details.checklist).length > 0) {
    parts.push("\nChecklist:");
    for (const [, item] of Object.entries(task.details.checklist) as [string, PlannerChecklistItem][]) {
      const check = item.isChecked ? "[x]" : "[ ]";
      parts.push(`  ${check} ${item.title}`);
    }
  }

  if (task.details?.references && Object.keys(task.details.references).length > 0) {
    parts.push("\nReferences:");
    for (const [url, ref] of Object.entries(task.details.references)) {
      const decoded = decodeURIComponent(url);
      parts.push(`  - ${ref.alias ?? decoded}`);
    }
  }

  if (task["@odata.etag"]) parts.push(`\netag: ${task["@odata.etag"]}`);
  parts.push(`id: ${task.id}`);

  return parts.join("\n");
}

function formatBucket(bucket: PlannerBucket): string {
  return `- ${bucket.name} (id: ${bucket.id})`;
}

// ---------------------------------------------------------------------------
// planner_plans
// ---------------------------------------------------------------------------

export function plannerPlansTool(): AgentTool {
  return {
    name: "planner_plans",
    description:
      "List the user's Microsoft Planner plans. Returns plan titles, owners, and IDs.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
    async execute(_input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const response = await graphRequest<GraphCollectionResponse<PlannerPlan>>({
        token: context.token,
        path: "/me/planner/plans",
      });

      const plans = response.value;
      if (plans.length === 0) {
        return { content: "No plans found." };
      }

      const lines = plans.map(formatPlan);
      return { content: `Found ${plans.length} plan(s):\n${lines.join("\n")}` };
    },
  };
}

// ---------------------------------------------------------------------------
// planner_tasks
// ---------------------------------------------------------------------------

export function plannerTasksTool(): AgentTool {
  return {
    name: "planner_tasks",
    description:
      "List tasks in a Microsoft Planner plan. Returns task titles, status, priority, due dates, and IDs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        planId: { type: "string", description: "The Planner plan ID (required)." },
      },
      required: ["planId"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const planId = typeof input.planId === "string" ? input.planId : "";
      if (!planId) return missingParam("planId");

      const response = await graphRequest<GraphCollectionResponse<PlannerTask>>({
        token: context.token,
        path: `/planner/plans/${planId}/tasks`,
      });

      const tasks = response.value;
      if (tasks.length === 0) {
        return { content: "No tasks found in this plan." };
      }

      const lines = tasks.map(formatTaskSummary);
      return { content: `Found ${tasks.length} task(s):\n${lines.join("\n")}` };
    },
  };
}

// ---------------------------------------------------------------------------
// planner_read
// ---------------------------------------------------------------------------

export function plannerReadTool(): AgentTool {
  return {
    name: "planner_read",
    description:
      "Read full details of a specific Planner task by ID, including description, checklist, references, and etag for updates.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "The Planner task ID (required)." },
      },
      required: ["taskId"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const taskId = typeof input.taskId === "string" ? input.taskId : "";
      if (!taskId) return missingParam("taskId");

      const task = await graphRequest<PlannerTaskWithDetails>({
        token: context.token,
        path: `/planner/tasks/${taskId}?$expand=details`,
      });

      return { content: formatTaskDetail(task) };
    },
  };
}

// ---------------------------------------------------------------------------
// planner_create
// ---------------------------------------------------------------------------

export function plannerCreateTool(): AgentTool {
  return {
    name: "planner_create",
    description:
      "Create a new task in a Microsoft Planner plan. Requires planId and title. Optionally set bucketId, dueDateTime, priority (0=Urgent, 1=Important, 5=Medium, 9=Low), and assignments.",
    inputSchema: {
      type: "object" as const,
      properties: {
        planId: { type: "string", description: "The Planner plan ID (required)." },
        title: { type: "string", description: "Task title (required)." },
        bucketId: { type: "string", description: "Optional bucket ID to place the task in." },
        dueDateTime: { type: "string", description: "Optional due date in ISO 8601 format." },
        priority: {
          type: "number",
          description: "Optional priority: 0=Urgent, 1=Important, 5=Medium, 9=Low.",
        },
        assignments: {
          type: "object",
          description: 'Optional assignments object: { "userId": { "orderHint": "" } }.',
        },
      },
      required: ["planId", "title"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const planId = typeof input.planId === "string" ? input.planId : "";
      if (!planId) return missingParam("planId");

      const title = typeof input.title === "string" ? input.title : "";
      if (!title) return missingParam("title");

      const body: Record<string, unknown> = { planId, title };

      if (typeof input.bucketId === "string" && input.bucketId) {
        body.bucketId = input.bucketId;
      }
      if (input.dueDateTime !== undefined) {
        body.dueDateTime = input.dueDateTime;
      }
      if (input.priority !== undefined) {
        body.priority = input.priority;
      }
      if (input.assignments !== undefined) {
        body.assignments = input.assignments;
      }

      const task = await graphRequest<PlannerTask>({
        token: context.token,
        path: "/planner/tasks",
        method: "POST",
        body,
      });

      const due = task.dueDateTime ? ` due ${formatDate(task.dueDateTime)}` : "";
      return {
        content: `Task created: "${task.title}" (id: ${task.id})${due}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// planner_update
// ---------------------------------------------------------------------------

export function plannerUpdateTool(): AgentTool {
  return {
    name: "planner_update",
    description:
      'Update a Planner task. Requires taskId and etag (for optimistic concurrency via If-Match header). Get the etag from planner_read. Optionally update title, percentComplete (0/50/100), dueDateTime, priority, bucketId.',
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "The Planner task ID (required)." },
        etag: {
          type: "string",
          description: 'The task etag for concurrency control (required). Get from planner_read.',
        },
        title: { type: "string", description: "New task title." },
        percentComplete: {
          type: "number",
          description: "New completion percentage: 0=Not started, 50=In progress, 100=Complete.",
        },
        dueDateTime: { type: "string", description: "New due date in ISO 8601 format." },
        priority: {
          type: "number",
          description: "New priority: 0=Urgent, 1=Important, 5=Medium, 9=Low.",
        },
        bucketId: { type: "string", description: "Move task to a different bucket." },
      },
      required: ["taskId", "etag"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const taskId = typeof input.taskId === "string" ? input.taskId : "";
      if (!taskId) return missingParam("taskId");

      const etag = typeof input.etag === "string" ? input.etag : "";
      if (!etag) return missingParam("etag");

      const patch: Record<string, unknown> = {};

      if (typeof input.title === "string" && input.title) patch.title = input.title;
      if (input.percentComplete !== undefined) patch.percentComplete = input.percentComplete;
      if (input.dueDateTime !== undefined) patch.dueDateTime = input.dueDateTime;
      if (input.priority !== undefined) patch.priority = input.priority;
      if (typeof input.bucketId === "string" && input.bucketId) patch.bucketId = input.bucketId;

      if (Object.keys(patch).length === 0) {
        return {
          content: "No properties to update. Provide at least one of: title, percentComplete, dueDateTime, priority, bucketId.",
          isError: true,
        };
      }

      const task = await graphRequest<PlannerTask>({
        token: context.token,
        path: `/planner/tasks/${taskId}`,
        method: "PATCH",
        headers: {
          "If-Match": etag,
        },
        body: patch,
      });

      return { content: `Task updated: "${task.title}" (id: ${task.id})` };
    },
  };
}

// ---------------------------------------------------------------------------
// planner_buckets
// ---------------------------------------------------------------------------

export function plannerBucketsTool(): AgentTool {
  return {
    name: "planner_buckets",
    description:
      "List buckets (columns) in a Microsoft Planner plan. Returns bucket names and IDs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        planId: { type: "string", description: "The Planner plan ID (required)." },
      },
      required: ["planId"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const planId = typeof input.planId === "string" ? input.planId : "";
      if (!planId) return missingParam("planId");

      const response = await graphRequest<GraphCollectionResponse<PlannerBucket>>({
        token: context.token,
        path: `/planner/plans/${planId}/buckets`,
      });

      const buckets = response.value;
      if (buckets.length === 0) {
        return { content: "No buckets found in this plan." };
      }

      const lines = buckets.map(formatBucket);
      return { content: `Found ${buckets.length} bucket(s):\n${lines.join("\n")}` };
    },
  };
}
