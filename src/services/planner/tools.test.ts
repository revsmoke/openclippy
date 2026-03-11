import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlannerPlan, PlannerTask, PlannerBucket, PlannerTaskWithDetails } from "./types.js";
import {
  plannerPlansTool,
  plannerTasksTool,
  plannerReadTool,
  plannerCreateTool,
  plannerUpdateTool,
  plannerBucketsTool,
} from "./tools.js";
import { createToolContext } from "../../test-utils/graph-mock.js";

// ---------------------------------------------------------------------------
// Mock graphRequest
// ---------------------------------------------------------------------------

const mockGraphRequest = vi.fn();

vi.mock("../../graph/client.js", () => ({
  graphRequest: (...args: unknown[]) => mockGraphRequest(...args),
}));

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

const ctx = createToolContext();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const samplePlan: PlannerPlan = {
  id: "plan-1",
  title: "Sprint 42",
  owner: "user-abc",
  createdDateTime: "2025-03-01T08:00:00Z",
  container: {
    containerId: "group-xyz",
    type: "group",
  },
  createdBy: {
    user: {
      displayName: "Jane Manager",
      id: "user-abc",
    },
  },
};

const samplePlanMinimal: PlannerPlan = {
  id: "plan-2",
  title: "Personal Board",
};

const sampleTask: PlannerTask = {
  id: "task-1",
  planId: "plan-1",
  bucketId: "bucket-1",
  title: "Implement login page",
  percentComplete: 50,
  priority: 1,
  startDateTime: "2025-03-05T00:00:00Z",
  dueDateTime: "2025-03-15T00:00:00Z",
  createdDateTime: "2025-03-01T10:00:00Z",
  assignments: {
    "user-abc": { orderHint: "1" },
  },
  orderHint: "8585034",
  "@odata.etag": 'W/"etag-abc123"',
};

const sampleTaskMinimal: PlannerTask = {
  id: "task-2",
  planId: "plan-1",
  title: "Quick fix",
  percentComplete: 0,
  priority: 9,
};

const sampleTaskWithDetails: PlannerTaskWithDetails = {
  ...sampleTask,
  details: {
    id: "task-1",
    description: "Build the login page with OAuth support",
    checklist: {
      "check-1": { title: "Design mockup", isChecked: true },
      "check-2": { title: "Write tests", isChecked: false },
    },
    references: {
      "https%3A//figma.com/design": {
        alias: "Figma design",
        type: "other",
      },
    },
  },
};

const sampleBucket: PlannerBucket = {
  id: "bucket-1",
  name: "To Do",
  planId: "plan-1",
  orderHint: "8585034",
};

const sampleBucketMinimal: PlannerBucket = {
  id: "bucket-2",
  name: "Done",
  planId: "plan-1",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGraphRequest.mockReset();
});

// ---------------------------------------------------------------------------
// planner_plans
// ---------------------------------------------------------------------------

describe("planner_plans", () => {
  const tool = plannerPlansTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("planner_plans");
    expect(tool.description).toBeTruthy();
  });

  it("lists plans with formatted output", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [samplePlan, samplePlanMinimal],
    });

    const result = await tool.execute({}, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("2 plan(s)");
    expect(result.content).toContain("Sprint 42");
    expect(result.content).toContain("plan-1");
    expect(result.content).toContain("Jane Manager");
    expect(result.content).toContain("Personal Board");
    expect(result.content).toContain("plan-2");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        path: "/me/planner/plans",
      }),
    );
  });

  it("formats plan with minimal data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [samplePlanMinimal],
    });

    const result = await tool.execute({}, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Personal Board");
    expect(result.content).toContain("1 plan(s)");
  });

  it("returns message when no plans found", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({}, ctx);

    expect(result.content).toContain("No plans found");
  });
});

// ---------------------------------------------------------------------------
// planner_tasks
// ---------------------------------------------------------------------------

describe("planner_tasks", () => {
  const tool = plannerTasksTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("planner_tasks");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.required).toContain("planId");
  });

  it("lists tasks with formatted output", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleTask, sampleTaskMinimal],
    });

    const result = await tool.execute({ planId: "plan-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("2 task(s)");
    expect(result.content).toContain("Implement login page");
    expect(result.content).toContain("In progress");
    expect(result.content).toContain("Important");
    expect(result.content).toContain("2025-03-15");
    expect(result.content).toContain("Quick fix");
    expect(result.content).toContain("Not started");
    expect(result.content).toContain("Low");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        path: "/planner/plans/plan-1/tasks",
      }),
    );
  });

  it("formats task with minimal data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleTaskMinimal],
    });

    const result = await tool.execute({ planId: "plan-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Quick fix");
    expect(result.content).toContain("1 task(s)");
  });

  it("returns message when no tasks found", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({ planId: "plan-1" }, ctx);

    expect(result.content).toContain("No tasks found");
  });

  it("returns error when planId is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("planId");
  });
});

// ---------------------------------------------------------------------------
// planner_read
// ---------------------------------------------------------------------------

describe("planner_read", () => {
  const tool = plannerReadTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("planner_read");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.required).toContain("taskId");
  });

  it("reads a task with full details", async () => {
    mockGraphRequest.mockResolvedValue(sampleTaskWithDetails);

    const result = await tool.execute({ taskId: "task-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Implement login page");
    expect(result.content).toContain("In progress");
    expect(result.content).toContain("Important");
    expect(result.content).toContain("2025-03-15");
    expect(result.content).toContain("Build the login page with OAuth support");
    expect(result.content).toContain("Design mockup");
    expect(result.content).toContain("Write tests");
    expect(result.content).toContain("task-1");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        path: "/planner/tasks/task-1?$expand=details",
      }),
    );
  });

  it("reads a task with minimal data", async () => {
    mockGraphRequest.mockResolvedValue(sampleTaskMinimal);

    const result = await tool.execute({ taskId: "task-2" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Quick fix");
    expect(result.content).toContain("Not started");
    expect(result.content).toContain("Low");
  });

  it("returns error when taskId is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("taskId");
  });
});

// ---------------------------------------------------------------------------
// planner_create
// ---------------------------------------------------------------------------

describe("planner_create", () => {
  const tool = plannerCreateTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("planner_create");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.required).toContain("planId");
    expect(tool.inputSchema.required).toContain("title");
  });

  it("creates a task with required fields only", async () => {
    mockGraphRequest.mockResolvedValue({ ...sampleTask });

    const result = await tool.execute({ planId: "plan-1", title: "New task" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Task created");
    expect(result.content).toContain("Implement login page");
    expect(result.content).toContain("task-1");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/planner/tasks",
        body: expect.objectContaining({
          planId: "plan-1",
          title: "New task",
        }),
      }),
    );
  });

  it("creates a task with all optional fields", async () => {
    mockGraphRequest.mockResolvedValue({ ...sampleTask });

    const result = await tool.execute(
      {
        planId: "plan-1",
        title: "New task",
        bucketId: "bucket-1",
        dueDateTime: "2025-04-01T00:00:00Z",
        priority: 1,
        assignments: { "user-abc": { orderHint: "" } },
      },
      ctx,
    );

    expect(result.isError).toBeUndefined();

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          planId: "plan-1",
          title: "New task",
          bucketId: "bucket-1",
          dueDateTime: "2025-04-01T00:00:00Z",
          priority: 1,
          assignments: { "user-abc": { orderHint: "" } },
        }),
      }),
    );
  });

  it("returns error when planId is missing", async () => {
    const result = await tool.execute({ title: "Test" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("planId");
  });

  it("returns error when title is missing", async () => {
    const result = await tool.execute({ planId: "plan-1" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("title");
  });
});

// ---------------------------------------------------------------------------
// planner_update
// ---------------------------------------------------------------------------

describe("planner_update", () => {
  const tool = plannerUpdateTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("planner_update");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.required).toContain("taskId");
    expect(tool.inputSchema.required).toContain("etag");
  });

  it("updates task title with If-Match header", async () => {
    mockGraphRequest.mockResolvedValue({ ...sampleTask, title: "Updated title" });

    const result = await tool.execute(
      { taskId: "task-1", etag: 'W/"etag-abc123"', title: "Updated title" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Task updated");
    expect(result.content).toContain("Updated title");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        path: "/planner/tasks/task-1",
        headers: expect.objectContaining({
          "If-Match": 'W/"etag-abc123"',
        }),
        body: { title: "Updated title" },
      }),
    );
  });

  it("updates multiple properties", async () => {
    mockGraphRequest.mockResolvedValue({
      ...sampleTask,
      title: "Updated",
      percentComplete: 100,
      priority: 0,
    });

    await tool.execute(
      {
        taskId: "task-1",
        etag: 'W/"etag-abc123"',
        title: "Updated",
        percentComplete: 100,
        dueDateTime: "2025-04-01T00:00:00Z",
        priority: 0,
      },
      ctx,
    );

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          "If-Match": 'W/"etag-abc123"',
        }),
        body: {
          title: "Updated",
          percentComplete: 100,
          dueDateTime: "2025-04-01T00:00:00Z",
          priority: 0,
        },
      }),
    );
  });

  it("returns error when taskId is missing", async () => {
    const result = await tool.execute({ etag: 'W/"etag"', title: "X" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("taskId");
  });

  it("returns error when etag is missing", async () => {
    const result = await tool.execute({ taskId: "task-1", title: "X" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("etag");
  });

  it("returns error when no properties to update", async () => {
    const result = await tool.execute(
      { taskId: "task-1", etag: 'W/"etag-abc123"' },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("No properties to update");
  });
});

// ---------------------------------------------------------------------------
// planner_buckets
// ---------------------------------------------------------------------------

describe("planner_buckets", () => {
  const tool = plannerBucketsTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("planner_buckets");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.required).toContain("planId");
  });

  it("lists buckets with formatted output", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleBucket, sampleBucketMinimal],
    });

    const result = await tool.execute({ planId: "plan-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("2 bucket(s)");
    expect(result.content).toContain("To Do");
    expect(result.content).toContain("bucket-1");
    expect(result.content).toContain("Done");
    expect(result.content).toContain("bucket-2");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        path: "/planner/plans/plan-1/buckets",
      }),
    );
  });

  it("formats bucket with minimal data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleBucketMinimal],
    });

    const result = await tool.execute({ planId: "plan-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Done");
    expect(result.content).toContain("1 bucket(s)");
  });

  it("returns message when no buckets found", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({ planId: "plan-1" }, ctx);

    expect(result.content).toContain("No buckets found");
  });

  it("returns error when planId is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("planId");
  });
});

// ---------------------------------------------------------------------------
// Module integration
// ---------------------------------------------------------------------------

describe("plannerModule integration", () => {
  it("exports 6 tools with correct names", async () => {
    const { plannerModule } = await import("./module.js");
    const tools = plannerModule.tools();

    expect(tools).toHaveLength(6);
    expect(tools.map((t) => t.name)).toEqual([
      "planner_plans",
      "planner_tasks",
      "planner_read",
      "planner_create",
      "planner_update",
      "planner_buckets",
    ]);
  });

  it("has correct module metadata", async () => {
    const { plannerModule } = await import("./module.js");

    expect(plannerModule.id).toBe("planner");
    expect(plannerModule.meta.requiredScopes).toContain("Tasks.Read");
    expect(plannerModule.meta.optionalScopes).toContain("Tasks.ReadWrite");
    expect(plannerModule.meta.optionalScopes).toContain("Group.Read.All");
    expect(plannerModule.capabilities.read).toBe(true);
    expect(plannerModule.capabilities.write).toBe(true);
    expect(plannerModule.capabilities.delete).toBe(false);
    expect(plannerModule.capabilities.search).toBe(false);
  });

  it("provides prompt hints", async () => {
    const { plannerModule } = await import("./module.js");

    const hints = plannerModule.promptHints?.();
    expect(hints).toBeDefined();
    expect(hints!.length).toBeGreaterThan(0);
  });
});
