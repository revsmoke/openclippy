/**
 * Tests for SubscriptionManager — Graph change notification lifecycle.
 *
 * TDD: These tests were written FIRST, before the implementation.
 * Mocks graphRequest to avoid real Graph API calls.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";

// Mock graphRequest before importing SubscriptionManager
vi.mock("../graph/client.js", () => ({
  graphRequest: vi.fn(),
  GraphApiError: class GraphApiError extends Error {
    constructor(
      public readonly path: string,
      public readonly status: number,
      public readonly body: string,
      public readonly code?: string,
    ) {
      super(`Graph API ${path} failed (${status}): ${body.slice(0, 200)}`);
      this.name = "GraphApiError";
    }
    get isThrottled(): boolean { return this.status === 429; }
    get isNotFound(): boolean { return this.status === 404; }
  },
}));

import { graphRequest } from "../graph/client.js";
import {
  SubscriptionManager,
  RESOURCE_MAP,
  MAX_EXPIRATION_MINUTES,
  type SubscriptionResource,
  type GraphSubscription,
  type GraphNotification,
  type NotificationEvent,
  type SubscriptionManagerConfig,
} from "./subscriptions.js";

const mockGraphRequest = vi.mocked(graphRequest);

// ── Helpers ─────────────────────────────────────────────────

function makeSubscriptionResponse(overrides?: Partial<GraphSubscription>): GraphSubscription {
  return {
    id: "sub-123",
    resource: "/me/mailFolders('Inbox')/messages",
    changeType: "created,updated,deleted",
    notificationUrl: "https://example.com/webhooks/graph",
    expirationDateTime: new Date(Date.now() + 4230 * 60 * 1000).toISOString(),
    clientState: "openclippy-secret",
    ...overrides,
  };
}

function makeNotificationPayload(overrides?: Partial<GraphNotification>): { value: GraphNotification[] } {
  return {
    value: [
      {
        subscriptionId: "sub-123",
        changeType: "created",
        resource: "me/mailFolders('Inbox')/messages/AAMk123",
        resourceData: { id: "AAMk123" },
        tenantId: "tenant-abc",
        ...overrides,
      },
    ],
  };
}

function defaultConfig(): SubscriptionManagerConfig {
  return {
    token: "test-token",
    notificationUrl: "https://example.com/webhooks/graph",
    clientState: "openclippy-secret",
    renewBufferMinutes: 30,
  };
}

// ── Tests ───────────────────────────────────────────────────

describe("SubscriptionManager", () => {
  let manager: SubscriptionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SubscriptionManager(defaultConfig());
  });

  afterEach(async () => {
    // Ensure cleanup even if test fails
    await manager.stop();
  });

  // ── Resource mapping ────────────────────────────────────

  describe("RESOURCE_MAP", () => {
    it("maps mail to Inbox messages resource", () => {
      expect(RESOURCE_MAP.mail).toBe("/me/mailFolders('Inbox')/messages");
    });

    it("maps calendar to events resource", () => {
      expect(RESOURCE_MAP.calendar).toBe("/me/events");
    });

    it("maps todo to a template with {listId} placeholder", () => {
      expect(RESOURCE_MAP.todo).toContain("todo/lists");
    });
  });

  // ── Create subscription ─────────────────────────────────

  describe("createSubscription", () => {
    it("creates a mail subscription via Graph API", async () => {
      const subResponse = makeSubscriptionResponse();
      mockGraphRequest.mockResolvedValueOnce(subResponse);

      const result = await manager.createSubscription("mail");

      expect(mockGraphRequest).toHaveBeenCalledOnce();
      const callArgs = mockGraphRequest.mock.calls[0]![0];
      expect(callArgs.method).toBe("POST");
      expect(callArgs.path).toBe("/subscriptions");
      expect(callArgs.token).toBe("test-token");

      const body = callArgs.body as Record<string, unknown>;
      expect(body.resource).toBe("/me/mailFolders('Inbox')/messages");
      expect(body.changeType).toBe("created,updated,deleted");
      expect(body.notificationUrl).toBe("https://example.com/webhooks/graph");
      expect(body.clientState).toBe("openclippy-secret");
      expect(typeof body.expirationDateTime).toBe("string");

      expect(result).toEqual(subResponse);
    });

    it("creates a calendar subscription", async () => {
      const subResponse = makeSubscriptionResponse({
        resource: "/me/events",
      });
      mockGraphRequest.mockResolvedValueOnce(subResponse);

      const result = await manager.createSubscription("calendar");

      const body = mockGraphRequest.mock.calls[0]![0].body as Record<string, unknown>;
      expect(body.resource).toBe("/me/events");
      expect(result.resource).toBe("/me/events");
    });

    it("creates a todo subscription with listId", async () => {
      const resource = "/me/todo/lists/list-456/tasks";
      const subResponse = makeSubscriptionResponse({ resource });
      mockGraphRequest.mockResolvedValueOnce(subResponse);

      const result = await manager.createSubscription("todo", { todoListId: "list-456" });

      const body = mockGraphRequest.mock.calls[0]![0].body as Record<string, unknown>;
      expect(body.resource).toBe(resource);
      expect(result.resource).toBe(resource);
    });

    it("throws if todo subscription is created without listId", async () => {
      await expect(manager.createSubscription("todo")).rejects.toThrow(/listId/i);
    });

    it("sets expiration to max allowed minutes", async () => {
      mockGraphRequest.mockResolvedValueOnce(makeSubscriptionResponse());

      await manager.createSubscription("mail");

      const body = mockGraphRequest.mock.calls[0]![0].body as Record<string, unknown>;
      const expiry = new Date(body.expirationDateTime as string);
      const now = Date.now();
      // Should be close to MAX_EXPIRATION_MINUTES from now (within 1 min tolerance)
      const diffMinutes = (expiry.getTime() - now) / (60 * 1000);
      expect(diffMinutes).toBeGreaterThan(MAX_EXPIRATION_MINUTES - 2);
      expect(diffMinutes).toBeLessThanOrEqual(MAX_EXPIRATION_MINUTES + 1);
    });

    it("tracks the subscription internally after creation", async () => {
      mockGraphRequest.mockResolvedValueOnce(makeSubscriptionResponse());

      await manager.createSubscription("mail");

      expect(manager.activeSubscriptions.size).toBe(1);
      expect(manager.activeSubscriptions.has("sub-123")).toBe(true);
    });

    it("handles Graph API error on create", async () => {
      const { GraphApiError } = await import("../graph/client.js");
      mockGraphRequest.mockRejectedValueOnce(
        new GraphApiError("/subscriptions", 403, "Forbidden", "Authorization_RequestDenied"),
      );

      await expect(manager.createSubscription("mail")).rejects.toThrow(/403/);
      expect(manager.activeSubscriptions.size).toBe(0);
    });
  });

  // ── Renew subscription ──────────────────────────────────

  describe("renewSubscription", () => {
    it("renews a subscription by ID via PATCH", async () => {
      // First create
      mockGraphRequest.mockResolvedValueOnce(makeSubscriptionResponse());
      await manager.createSubscription("mail");

      // Then renew
      const renewed = makeSubscriptionResponse({
        expirationDateTime: new Date(Date.now() + 4230 * 60 * 1000 + 60_000).toISOString(),
      });
      mockGraphRequest.mockResolvedValueOnce(renewed);

      const result = await manager.renewSubscription("sub-123");

      expect(mockGraphRequest).toHaveBeenCalledTimes(2);
      const callArgs = mockGraphRequest.mock.calls[1]![0];
      expect(callArgs.method).toBe("PATCH");
      expect(callArgs.path).toBe("/subscriptions/sub-123");
      expect(callArgs.token).toBe("test-token");

      const body = callArgs.body as Record<string, unknown>;
      expect(typeof body.expirationDateTime).toBe("string");

      expect(result).toEqual(renewed);
    });

    it("updates the internal tracking after renew", async () => {
      mockGraphRequest.mockResolvedValueOnce(makeSubscriptionResponse());
      await manager.createSubscription("mail");

      const newExpiry = new Date(Date.now() + 5000 * 60 * 1000).toISOString();
      mockGraphRequest.mockResolvedValueOnce(
        makeSubscriptionResponse({ expirationDateTime: newExpiry }),
      );

      await manager.renewSubscription("sub-123");

      const tracked = manager.activeSubscriptions.get("sub-123");
      expect(tracked).toBeDefined();
      expect(tracked!.expirationDateTime).toBe(newExpiry);
    });

    it("throws if subscription ID is not tracked", async () => {
      await expect(manager.renewSubscription("nonexistent")).rejects.toThrow(/not found|not tracked/i);
    });

    it("handles Graph API error on renew", async () => {
      mockGraphRequest.mockResolvedValueOnce(makeSubscriptionResponse());
      await manager.createSubscription("mail");

      const { GraphApiError } = await import("../graph/client.js");
      mockGraphRequest.mockRejectedValueOnce(
        new GraphApiError("/subscriptions/sub-123", 404, "Not found", "ItemNotFound"),
      );

      await expect(manager.renewSubscription("sub-123")).rejects.toThrow(/404/);
    });
  });

  // ── Delete subscription ─────────────────────────────────

  describe("deleteSubscription", () => {
    it("deletes a subscription by ID via DELETE", async () => {
      mockGraphRequest.mockResolvedValueOnce(makeSubscriptionResponse());
      await manager.createSubscription("mail");

      mockGraphRequest.mockResolvedValueOnce(undefined); // 204 No Content

      await manager.deleteSubscription("sub-123");

      expect(mockGraphRequest).toHaveBeenCalledTimes(2);
      const callArgs = mockGraphRequest.mock.calls[1]![0];
      expect(callArgs.method).toBe("DELETE");
      expect(callArgs.path).toBe("/subscriptions/sub-123");
    });

    it("removes subscription from internal tracking", async () => {
      mockGraphRequest.mockResolvedValueOnce(makeSubscriptionResponse());
      await manager.createSubscription("mail");
      expect(manager.activeSubscriptions.size).toBe(1);

      mockGraphRequest.mockResolvedValueOnce(undefined);
      await manager.deleteSubscription("sub-123");

      expect(manager.activeSubscriptions.size).toBe(0);
    });

    it("throws if subscription ID is not tracked", async () => {
      await expect(manager.deleteSubscription("nonexistent")).rejects.toThrow(/not found|not tracked/i);
    });

    it("still removes from tracking even if Graph API delete fails with 404", async () => {
      mockGraphRequest.mockResolvedValueOnce(makeSubscriptionResponse());
      await manager.createSubscription("mail");

      const { GraphApiError } = await import("../graph/client.js");
      mockGraphRequest.mockRejectedValueOnce(
        new GraphApiError("/subscriptions/sub-123", 404, "Not found", "ItemNotFound"),
      );

      // Should NOT throw for 404 — subscription is already gone server-side
      await manager.deleteSubscription("sub-123");
      expect(manager.activeSubscriptions.size).toBe(0);
    });
  });

  // ── Process notification ────────────────────────────────

  describe("processNotification", () => {
    it("parses a mail notification into NotificationEvent", () => {
      const payload = makeNotificationPayload();
      const events = manager.processNotification(payload);

      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.source).toBe("mail");
      expect(event.changeType).toBe("created");
      expect(event.resourcePath).toBe("me/mailFolders('Inbox')/messages/AAMk123");
      expect(event.data).toEqual({ id: "AAMk123" });
    });

    it("parses a calendar notification", () => {
      const payload = makeNotificationPayload({
        resource: "me/events/evt-789",
        changeType: "updated",
      });
      const events = manager.processNotification(payload);

      expect(events[0]!.source).toBe("calendar");
      expect(events[0]!.changeType).toBe("updated");
    });

    it("parses a todo notification", () => {
      const payload = makeNotificationPayload({
        resource: "me/todo/lists/list-1/tasks/task-2",
        changeType: "deleted",
      });
      const events = manager.processNotification(payload);

      expect(events[0]!.source).toBe("todo");
      expect(events[0]!.changeType).toBe("deleted");
    });

    it("handles multiple notifications in a single payload", () => {
      const payload = {
        value: [
          {
            subscriptionId: "sub-1",
            changeType: "created" as const,
            resource: "me/mailFolders('Inbox')/messages/AAMk1",
            tenantId: "t-1",
          },
          {
            subscriptionId: "sub-2",
            changeType: "updated" as const,
            resource: "me/events/evt-1",
            tenantId: "t-1",
          },
        ],
      };
      const events = manager.processNotification(payload);
      expect(events).toHaveLength(2);
      expect(events[0]!.source).toBe("mail");
      expect(events[1]!.source).toBe("calendar");
    });

    it("returns empty array for empty payload", () => {
      const events = manager.processNotification({ value: [] });
      expect(events).toEqual([]);
    });

    it("returns empty array for missing value property", () => {
      const events = manager.processNotification({});
      expect(events).toEqual([]);
    });

    it("classifies unknown resource paths with source 'unknown'", () => {
      const payload = makeNotificationPayload({
        resource: "me/contacts/123",
      });
      const events = manager.processNotification(payload);
      expect(events[0]!.source).toBe("unknown");
    });
  });

  // ── Client state validation ─────────────────────────────

  describe("validateClientState", () => {
    it("returns true for matching client state", () => {
      expect(manager.validateClientState("openclippy-secret")).toBe(true);
    });

    it("returns false for non-matching client state", () => {
      expect(manager.validateClientState("wrong-secret")).toBe(false);
    });

    it("returns false for undefined client state", () => {
      expect(manager.validateClientState(undefined)).toBe(false);
    });
  });

  // ── Auto-renew scheduling ───────────────────────────────

  describe("auto-renew lifecycle", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("starts auto-renew timer on start()", async () => {
      // Create a subscription that expires in 60 minutes
      const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      mockGraphRequest.mockResolvedValueOnce(makeSubscriptionResponse({ expirationDateTime: expiry }));

      await manager.createSubscription("mail");
      manager.start();

      expect(manager.isRunning).toBe(true);
    });

    it("auto-renews subscriptions before expiry", async () => {
      // Subscription expires in 35 minutes. Buffer is 30 min, so renew at ~5 min from now.
      const expiryMs = Date.now() + 35 * 60 * 1000;
      const expiry = new Date(expiryMs).toISOString();
      mockGraphRequest.mockResolvedValueOnce(
        makeSubscriptionResponse({ expirationDateTime: expiry }),
      );

      await manager.createSubscription("mail");
      manager.start();

      // Prepare the renew response
      const renewedExpiry = new Date(expiryMs + 4230 * 60 * 1000).toISOString();
      mockGraphRequest.mockResolvedValueOnce(
        makeSubscriptionResponse({ expirationDateTime: renewedExpiry }),
      );

      // Advance past the check interval (manager checks periodically)
      // The renew should trigger because expiry - buffer < now + checkInterval
      await vi.advanceTimersByTimeAsync(6 * 60 * 1000);

      // Should have called renew (2 calls total: create + renew)
      expect(mockGraphRequest).toHaveBeenCalledTimes(2);
      const lastCall = mockGraphRequest.mock.calls[1]![0];
      expect(lastCall.method).toBe("PATCH");
      expect(lastCall.path).toBe("/subscriptions/sub-123");
    });

    it("stops auto-renew timer on stop()", async () => {
      mockGraphRequest.mockResolvedValueOnce(makeSubscriptionResponse());
      await manager.createSubscription("mail");
      manager.start();

      await manager.stop();

      expect(manager.isRunning).toBe(false);
    });

    it("deletes all active subscriptions on stop()", async () => {
      // Create two subscriptions
      mockGraphRequest.mockResolvedValueOnce(makeSubscriptionResponse({ id: "sub-A" }));
      mockGraphRequest.mockResolvedValueOnce(
        makeSubscriptionResponse({ id: "sub-B", resource: "/me/events" }),
      );

      await manager.createSubscription("mail");
      await manager.createSubscription("calendar");
      expect(manager.activeSubscriptions.size).toBe(2);

      // Mock the deletes
      mockGraphRequest.mockResolvedValueOnce(undefined);
      mockGraphRequest.mockResolvedValueOnce(undefined);

      await manager.stop();

      expect(manager.activeSubscriptions.size).toBe(0);
      // 2 creates + 2 deletes = 4 calls
      expect(mockGraphRequest).toHaveBeenCalledTimes(4);
    });
  });

  // ── Token update ────────────────────────────────────────

  describe("updateToken", () => {
    it("updates the token used for Graph API calls", async () => {
      mockGraphRequest.mockResolvedValueOnce(makeSubscriptionResponse());

      manager.updateToken("new-token-value");
      await manager.createSubscription("mail");

      const callArgs = mockGraphRequest.mock.calls[0]![0];
      expect(callArgs.token).toBe("new-token-value");
    });
  });

  // ── Multiple subscription management ───────────────────

  describe("multiple subscriptions", () => {
    it("manages mail + calendar subscriptions concurrently", async () => {
      mockGraphRequest
        .mockResolvedValueOnce(makeSubscriptionResponse({ id: "sub-mail" }))
        .mockResolvedValueOnce(
          makeSubscriptionResponse({ id: "sub-cal", resource: "/me/events" }),
        );

      await manager.createSubscription("mail");
      await manager.createSubscription("calendar");

      expect(manager.activeSubscriptions.size).toBe(2);
      expect(manager.activeSubscriptions.has("sub-mail")).toBe(true);
      expect(manager.activeSubscriptions.has("sub-cal")).toBe(true);
    });
  });
});
