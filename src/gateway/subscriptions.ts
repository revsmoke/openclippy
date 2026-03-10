/**
 * SubscriptionManager — Graph change notification lifecycle.
 *
 * Creates, renews, and deletes Microsoft Graph subscriptions for
 * real-time change notifications (mail, calendar, todo tasks).
 * Processes incoming webhook payloads into structured NotificationEvents.
 *
 * Integration: The Gateway's HTTP handler receives webhook POSTs at
 * /webhooks/graph and passes the payload to processNotification().
 */

import { graphRequest, GraphApiError } from "../graph/client.js";

// ── Types ───────────────────────────────────────────────────

export type SubscriptionResource = "mail" | "calendar" | "todo";

export type ChangeType = "created" | "updated" | "deleted";

export type GraphSubscription = {
  id: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  expirationDateTime: string;
  clientState: string;
};

export type GraphNotification = {
  subscriptionId: string;
  changeType: ChangeType;
  resource: string;
  resourceData?: Record<string, unknown>;
  tenantId: string;
};

export type NotificationEvent = {
  source: SubscriptionResource | "unknown";
  changeType: ChangeType;
  resourcePath: string;
  data?: Record<string, unknown>;
};

export type SubscriptionManagerConfig = {
  /** Bearer token for Graph API calls */
  token: string;
  /** Public URL where Graph sends notifications (e.g. https://host/webhooks/graph) */
  notificationUrl: string;
  /** Secret string Graph includes in notifications for validation */
  clientState: string;
  /** Minutes before expiry to trigger renewal (default: 30) */
  renewBufferMinutes?: number;
};

export type CreateSubscriptionOptions = {
  /** Required for todo subscriptions — the list to subscribe to */
  todoListId?: string;
};

// ── Constants ───────────────────────────────────────────────

/** Graph resource paths for each subscription type */
export const RESOURCE_MAP: Record<SubscriptionResource, string> = {
  mail: "/me/mailFolders('Inbox')/messages",
  calendar: "/me/events",
  todo: "/me/todo/lists/{listId}/tasks",
};

/** Maximum subscription lifetime in minutes (mail, calendar, todoTasks) */
export const MAX_EXPIRATION_MINUTES = 4230;

/** How often (ms) the auto-renew loop checks for expiring subscriptions */
const RENEW_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

// ── Internal tracking type ──────────────────────────────────

type TrackedSubscription = GraphSubscription & {
  resourceType: SubscriptionResource;
};

// ── SubscriptionManager ─────────────────────────────────────

export class SubscriptionManager {
  private _token: string;
  private _notificationUrl: string;
  private _clientState: string;
  private _renewBufferMinutes: number;
  private _subscriptions = new Map<string, TrackedSubscription>();
  private _renewTimer: ReturnType<typeof setInterval> | null = null;
  private _running = false;

  constructor(config: SubscriptionManagerConfig) {
    this._token = config.token;
    this._notificationUrl = config.notificationUrl;
    this._clientState = config.clientState;
    this._renewBufferMinutes = config.renewBufferMinutes ?? 30;
  }

  // ── Public accessors ────────────────────────────────────

  /** Read-only view of tracked subscriptions (id → subscription) */
  get activeSubscriptions(): ReadonlyMap<string, GraphSubscription> {
    return this._subscriptions;
  }

  /** Whether the auto-renew loop is running */
  get isRunning(): boolean {
    return this._running;
  }

  // ── Token management ────────────────────────────────────

  /** Update the bearer token (called after MSAL silent refresh) */
  updateToken(token: string): void {
    this._token = token;
  }

  // ── Create ──────────────────────────────────────────────

  /** Create a Graph subscription for the given resource type */
  async createSubscription(
    resourceType: SubscriptionResource,
    options?: CreateSubscriptionOptions,
  ): Promise<GraphSubscription> {
    const resource = this.resolveResource(resourceType, options);
    const expirationDateTime = this.computeExpiration();

    const subscription = await graphRequest<GraphSubscription>({
      token: this._token,
      path: "/subscriptions",
      method: "POST",
      body: {
        changeType: "created,updated,deleted",
        notificationUrl: this._notificationUrl,
        resource,
        expirationDateTime,
        clientState: this._clientState,
      },
    });

    this._subscriptions.set(subscription.id, {
      ...subscription,
      resourceType,
    });

    return subscription;
  }

  // ── Renew ───────────────────────────────────────────────

  /** Renew an existing subscription by extending its expiration */
  async renewSubscription(subscriptionId: string): Promise<GraphSubscription> {
    const tracked = this._subscriptions.get(subscriptionId);
    if (!tracked) {
      throw new Error(`Subscription ${subscriptionId} not found/not tracked`);
    }

    const expirationDateTime = this.computeExpiration();

    const renewed = await graphRequest<GraphSubscription>({
      token: this._token,
      path: `/subscriptions/${subscriptionId}`,
      method: "PATCH",
      body: { expirationDateTime },
    });

    // Update internal tracking with new expiration
    this._subscriptions.set(subscriptionId, {
      ...tracked,
      ...renewed,
      resourceType: tracked.resourceType,
    });

    return renewed;
  }

  // ── Delete ──────────────────────────────────────────────

  /** Delete a subscription. Tolerates 404 (already gone server-side). */
  async deleteSubscription(subscriptionId: string): Promise<void> {
    const tracked = this._subscriptions.get(subscriptionId);
    if (!tracked) {
      throw new Error(`Subscription ${subscriptionId} not found/not tracked`);
    }

    try {
      await graphRequest<void>({
        token: this._token,
        path: `/subscriptions/${subscriptionId}`,
        method: "DELETE",
      });
    } catch (err) {
      // Tolerate 404 — the subscription is already gone server-side
      if (err instanceof GraphApiError && err.isNotFound) {
        // fall through to remove from tracking
      } else {
        throw err;
      }
    }

    this._subscriptions.delete(subscriptionId);
  }

  // ── Process notifications ───────────────────────────────

  /**
   * Parse an incoming webhook payload into structured NotificationEvents.
   * The payload comes from the /webhooks/graph HTTP handler.
   */
  processNotification(payload: unknown): NotificationEvent[] {
    const obj = payload as Record<string, unknown> | undefined;
    if (!obj || !Array.isArray(obj.value)) {
      return [];
    }

    const notifications = obj.value as GraphNotification[];
    return notifications.map((n) => ({
      source: this.classifyResource(n.resource),
      changeType: n.changeType,
      resourcePath: n.resource,
      data: n.resourceData,
    }));
  }

  // ── Client state validation ─────────────────────────────

  /** Validate the clientState value from a notification matches our secret */
  validateClientState(clientState: string | undefined): boolean {
    if (clientState === undefined) return false;
    return clientState === this._clientState;
  }

  // ── Lifecycle (start/stop) ──────────────────────────────

  /** Start the auto-renew check loop */
  start(): void {
    if (this._running) return;
    this._running = true;

    this._renewTimer = setInterval(() => {
      void this.checkAndRenewExpiring();
    }, RENEW_CHECK_INTERVAL_MS);
  }

  /** Stop the auto-renew loop and delete all active subscriptions */
  async stop(): Promise<void> {
    if (this._renewTimer) {
      clearInterval(this._renewTimer);
      this._renewTimer = null;
    }
    this._running = false;

    // Delete all active subscriptions from Graph
    const deletePromises = [...this._subscriptions.keys()].map(async (id) => {
      try {
        await graphRequest<void>({
          token: this._token,
          path: `/subscriptions/${id}`,
          method: "DELETE",
        });
      } catch {
        // Best-effort cleanup — don't throw on stop
      }
    });

    await Promise.all(deletePromises);
    this._subscriptions.clear();
  }

  // ── Private helpers ─────────────────────────────────────

  /** Resolve the Graph resource path, substituting placeholders */
  private resolveResource(
    resourceType: SubscriptionResource,
    options?: CreateSubscriptionOptions,
  ): string {
    const template = RESOURCE_MAP[resourceType];

    if (resourceType === "todo") {
      if (!options?.todoListId) {
        throw new Error("todoListId is required for todo subscriptions");
      }
      return template.replace("{listId}", options.todoListId);
    }

    return template;
  }

  /** Compute expiration datetime string (max allowed) */
  private computeExpiration(): string {
    return new Date(Date.now() + MAX_EXPIRATION_MINUTES * 60 * 1000).toISOString();
  }

  /** Classify a resource path into a SubscriptionResource */
  private classifyResource(resource: string): SubscriptionResource | "unknown" {
    if (resource.includes("mailFolders") || resource.includes("messages")) {
      return "mail";
    }
    if (resource.includes("events")) {
      return "calendar";
    }
    if (resource.includes("todo")) {
      return "todo";
    }
    return "unknown";
  }

  /** Check all tracked subscriptions and renew any that are close to expiring */
  private async checkAndRenewExpiring(): Promise<void> {
    const now = Date.now();
    const bufferMs = this._renewBufferMinutes * 60 * 1000;

    for (const [id, sub] of this._subscriptions) {
      const expiresAt = new Date(sub.expirationDateTime).getTime();
      if (expiresAt - now <= bufferMs) {
        try {
          await this.renewSubscription(id);
        } catch {
          // Renewal failure is non-fatal — will retry on next check
        }
      }
    }
  }
}
