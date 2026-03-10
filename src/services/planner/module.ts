import type { ServiceModule } from "../types.js";
import {
  plannerPlansTool,
  plannerTasksTool,
  plannerReadTool,
  plannerCreateTool,
  plannerUpdateTool,
  plannerBucketsTool,
} from "./tools.js";

/**
 * Microsoft Planner service module.
 *
 * Exposes 6 tools for managing Planner plans, tasks, and buckets
 * via the Microsoft Graph API.
 */
export const plannerModule: ServiceModule = {
  id: "planner",

  meta: {
    label: "Planner",
    description: "Microsoft Planner task boards and plans",
    requiredScopes: ["Tasks.Read"],
    optionalScopes: ["Tasks.ReadWrite", "Group.Read.All"],
  },

  capabilities: {
    read: true,
    write: true,
    delete: false,
    search: false,
    subscribe: false,
  },

  tools: () => [
    plannerPlansTool(),
    plannerTasksTool(),
    plannerReadTool(),
    plannerCreateTool(),
    plannerUpdateTool(),
    plannerBucketsTool(),
  ],

  promptHints: () => [
    "Use planner_plans to list the user's Planner plans and boards",
    "Use planner_tasks to view tasks within a specific plan",
    "Use planner_create to add new tasks to a plan",
    "Use planner_update to change task status, priority, or due dates — requires the task's etag for optimistic concurrency",
  ],
};
