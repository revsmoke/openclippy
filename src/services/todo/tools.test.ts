import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TodoTask, TodoTaskList } from "./types.js";
import {
  todoListsTool,
  todoTasksTool,
  todoCreateTool,
  todoUpdateTool,
  todoCompleteTool,
  todoDeleteTool,
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

const sampleList: TodoTaskList = {
  id: "list-1",
  displayName: "My Tasks",
  isOwner: true,
  wellknownListName: "defaultList",
};

const sampleTask: TodoTask = {
  id: "task-1",
  title: "Buy groceries",
  status: "notStarted",
  importance: "normal",
  createdDateTime: "2025-01-15T10:00:00Z",
  dueDateTime: {
    dateTime: "2025-01-20T00:00:00",
    timeZone: "America/New_York",
  },
};

const completedTask: TodoTask = {
  id: "task-2",
  title: "File taxes",
  status: "completed",
  importance: "high",
  createdDateTime: "2025-01-10T08:00:00Z",
  completedDateTime: {
    dateTime: "2025-01-14T14:00:00",
    timeZone: "America/New_York",
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGraphRequest.mockReset();
});

describe("todo_lists", () => {
  const tool = todoListsTool();

  it("returns formatted list of task lists", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleList, { ...sampleList, id: "list-2", displayName: "Work", wellknownListName: "none" }],
    });

    const result = await tool.execute({}, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("2 task list(s)");
    expect(result.content).toContain("My Tasks");
    expect(result.content).toContain("[defaultList]");
    expect(result.content).toContain("Work");
    expect(result.content).not.toContain("[none]");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        path: "/me/todo/lists",
      }),
    );
  });

  it("returns message when no lists found", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({}, ctx);

    expect(result.content).toBe("No task lists found.");
  });
});

describe("todo_tasks", () => {
  const tool = todoTasksTool();

  it("returns formatted task list", async () => {
    mockGraphRequest.mockResolvedValue({ value: [sampleTask, completedTask] });

    const result = await tool.execute({ listId: "list-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("2 task(s)");
    expect(result.content).toContain("[ ] Buy groceries");
    expect(result.content).toContain("(due: 2025-01-20)");
    expect(result.content).toContain("[x] File taxes");
    expect(result.content).toContain("[high]");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("/me/todo/lists/list-1/tasks"),
      }),
    );
  });

  it("applies status filter", async () => {
    mockGraphRequest.mockResolvedValue({ value: [completedTask] });

    const result = await tool.execute({ listId: "list-1", status: "completed" }, ctx);

    expect(result.content).toContain("1 task(s)");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("$filter=status%20eq%20'completed'"),
      }),
    );
  });

  it("returns message when no tasks found", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({ listId: "list-1" }, ctx);

    expect(result.content).toBe("No tasks found in this list.");
  });

  it("returns message when no tasks match status filter", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({ listId: "list-1", status: "deferred" }, ctx);

    expect(result.content).toContain("No tasks with status 'deferred' found.");
  });

  it("returns error when listId is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("listId");
  });
});

describe("todo_create", () => {
  const tool = todoCreateTool();

  it("creates a task with title only", async () => {
    mockGraphRequest.mockResolvedValue({ ...sampleTask });

    const result = await tool.execute({ listId: "list-1", title: "Buy groceries" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('Task created: "Buy groceries"');
    expect(result.content).toContain("task-1");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/me/todo/lists/list-1/tasks",
        body: { title: "Buy groceries" },
      }),
    );
  });

  it("creates a task with all optional fields", async () => {
    mockGraphRequest.mockResolvedValue({ ...sampleTask, importance: "high" });

    const result = await tool.execute(
      {
        listId: "list-1",
        title: "Buy groceries",
        body: "Milk, eggs, bread",
        dueDateTime: "2025-01-20",
        importance: "high",
      },
      ctx,
    );

    expect(result.isError).toBeUndefined();

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        body: {
          title: "Buy groceries",
          body: { content: "Milk, eggs, bread", contentType: "text" },
          dueDateTime: { dateTime: "2025-01-20T00:00:00", timeZone: "America/New_York" },
          importance: "high",
        },
      }),
    );
  });

  it("uses UTC when timezone not in context", async () => {
    mockGraphRequest.mockResolvedValue({ ...sampleTask });

    await todoCreateTool().execute(
      { listId: "list-1", title: "Test", dueDateTime: "2025-06-01" },
      { token: "t" },
    );

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          dueDateTime: { dateTime: "2025-06-01T00:00:00", timeZone: "UTC" },
        }),
      }),
    );
  });

  it("returns error when listId is missing", async () => {
    const result = await tool.execute({ title: "Test" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("listId");
  });

  it("returns error when title is missing", async () => {
    const result = await tool.execute({ listId: "list-1" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("title");
  });
});

describe("todo_update", () => {
  const tool = todoUpdateTool();

  it("updates task title", async () => {
    mockGraphRequest.mockResolvedValue({ ...sampleTask, title: "Buy organic groceries" });

    const result = await tool.execute(
      { listId: "list-1", taskId: "task-1", title: "Buy organic groceries" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Task updated");
    expect(result.content).toContain("Buy organic groceries");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        path: "/me/todo/lists/list-1/tasks/task-1",
        body: { title: "Buy organic groceries" },
      }),
    );
  });

  it("updates multiple properties", async () => {
    mockGraphRequest.mockResolvedValue({ ...sampleTask, title: "Updated", importance: "high" });

    await tool.execute(
      {
        listId: "list-1",
        taskId: "task-1",
        title: "Updated",
        body: "New notes",
        importance: "high",
        dueDateTime: "2025-02-01",
      },
      ctx,
    );

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          title: "Updated",
          body: { content: "New notes", contentType: "text" },
          importance: "high",
          dueDateTime: { dateTime: "2025-02-01T00:00:00", timeZone: "America/New_York" },
        },
      }),
    );
  });

  it("returns error when no properties to update", async () => {
    const result = await tool.execute({ listId: "list-1", taskId: "task-1" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("No properties to update");
  });

  it("returns error when listId is missing", async () => {
    const result = await tool.execute({ taskId: "task-1", title: "X" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("listId");
  });

  it("returns error when taskId is missing", async () => {
    const result = await tool.execute({ listId: "list-1", title: "X" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("taskId");
  });
});

describe("todo_complete", () => {
  const tool = todoCompleteTool();

  it("marks a task as completed", async () => {
    mockGraphRequest.mockResolvedValue({ ...sampleTask, status: "completed" });

    const result = await tool.execute({ listId: "list-1", taskId: "task-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("marked as completed");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        path: "/me/todo/lists/list-1/tasks/task-1",
        body: { status: "completed" },
      }),
    );
  });

  it("returns error when listId is missing", async () => {
    const result = await tool.execute({ taskId: "task-1" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("listId");
  });

  it("returns error when taskId is missing", async () => {
    const result = await tool.execute({ listId: "list-1" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("taskId");
  });
});

describe("todo_delete", () => {
  const tool = todoDeleteTool();

  it("deletes a task", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await tool.execute({ listId: "list-1", taskId: "task-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("task-1 deleted");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: "/me/todo/lists/list-1/tasks/task-1",
      }),
    );
  });

  it("returns error when listId is missing", async () => {
    const result = await tool.execute({ taskId: "task-1" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("listId");
  });

  it("returns error when taskId is missing", async () => {
    const result = await tool.execute({ listId: "list-1" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("taskId");
  });
});

describe("todoModule integration", () => {
  it("exports 6 tools with correct names", async () => {
    // Dynamic import to avoid circular issues with mock
    const { todoModule } = await import("./module.js");
    const tools = todoModule.tools();

    expect(tools).toHaveLength(6);
    expect(tools.map((t) => t.name)).toEqual([
      "todo_lists",
      "todo_tasks",
      "todo_create",
      "todo_update",
      "todo_complete",
      "todo_delete",
    ]);
  });

  it("has correct module metadata", async () => {
    const { todoModule } = await import("./module.js");

    expect(todoModule.id).toBe("todo");
    expect(todoModule.meta.requiredScopes).toContain("Tasks.Read");
    expect(todoModule.meta.optionalScopes).toContain("Tasks.ReadWrite");
    expect(todoModule.capabilities.read).toBe(true);
    expect(todoModule.capabilities.write).toBe(true);
    expect(todoModule.capabilities.delete).toBe(true);
    expect(todoModule.capabilities.search).toBe(false);
  });

  it("provides prompt hints", async () => {
    const { todoModule } = await import("./module.js");

    const hints = todoModule.promptHints?.();
    expect(hints).toBeDefined();
    expect(hints!.length).toBeGreaterThan(0);
  });
});
