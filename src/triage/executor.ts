/**
 * Triage phase 3 (the acting half): execute approved actions directly
 * against Graph. Deterministic code — no agent involvement — using
 * graphRequestWithRetry for transient-failure resilience.
 */
import { graphRequestWithRetry } from "../graph/rate-limit.js";
import { GraphApiError } from "../graph/client.js";
import type { GraphCollectionResponse } from "../graph/client.js";
import type { GraphMailFolder } from "../services/mail/types.js";
import { getErrorMessage } from "../services/tool-utils.js";
import type { ProposedAction } from "./rule-types.js";
import { describeAction } from "./rule-types.js";

const WELL_KNOWN_FOLDERS = new Set([
  "inbox",
  "archive",
  "deleteditems",
  "junkemail",
  "drafts",
  "sentitems",
  "outbox",
]);

export type ExecutionResult = {
  ok: boolean;
  detail: string;
  error?: string;
};

/** In-memory folder name→id cache for one run; primed lazily. */
export class FolderResolver {
  private cache = new Map<string, string>();

  constructor(
    private readonly token: string,
    private readonly opts?: { createMissing?: boolean },
  ) {}

  /**
   * Resolve a folder path like "Vendors/Invoices" to a folder id,
   * walking child folders segment by segment (case-insensitive).
   * Well-known names (archive, deleteditems, …) pass through directly.
   * With createMissing, absent segments are created on the way down.
   */
  async resolve(folderPath: string): Promise<string> {
    const normalized = folderPath.trim().toLowerCase();
    if (WELL_KNOWN_FOLDERS.has(normalized.replace(/\s+/g, ""))) {
      return normalized.replace(/\s+/g, "");
    }

    const cached = this.cache.get(normalized);
    if (cached) return cached;

    const segments = folderPath
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) {
      throw new Error(`Invalid folder path: "${folderPath}"`);
    }

    let parentId: string | null = null;
    let resolvedId = "";
    for (const segment of segments) {
      const listPath: string = parentId
        ? `/me/mailFolders/${parentId}/childFolders?$top=100&$select=id,displayName`
        : "/me/mailFolders?$top=100&$select=id,displayName";
      const response: GraphCollectionResponse<GraphMailFolder> =
        await graphRequestWithRetry<GraphCollectionResponse<GraphMailFolder>>({
          token: this.token,
          path: listPath,
        });
      const match = (response.value ?? []).find(
        (f) => f.displayName.toLowerCase() === segment.toLowerCase(),
      );
      if (match) {
        resolvedId = match.id;
      } else if (this.opts?.createMissing) {
        const created = await graphRequestWithRetry<GraphMailFolder>({
          token: this.token,
          path: parentId
            ? `/me/mailFolders/${parentId}/childFolders`
            : "/me/mailFolders",
          method: "POST",
          body: { displayName: segment },
        });
        resolvedId = created.id;
      } else {
        throw new Error(
          `Mail folder "${segment}" not found (in path "${folderPath}")`,
        );
      }
      parentId = resolvedId;
    }

    this.cache.set(normalized, resolvedId);
    return resolvedId;
  }
}

/**
 * Execute one proposed action on one message. `cachedFolderId` is the
 * rule's cached id (if any) — used first, with a re-resolve-by-name
 * fallback when Graph reports it stale. Returns the fresh folder id via
 * onFolderResolved so callers can update the rule's cache.
 */
export async function executeAction(params: {
  token: string;
  messageId: string;
  action: ProposedAction;
  folders: FolderResolver;
  cachedFolderId?: string;
  onFolderResolved?: (folderId: string) => void;
}): Promise<ExecutionResult> {
  const { token, messageId, action } = params;
  const detail = describeAction(action);

  try {
    switch (action.type) {
      case "move": {
        let destinationId =
          params.cachedFolderId ?? action.folderId ?? null;
        const moveOnce = (dest: string) =>
          graphRequestWithRetry<unknown>({
            token,
            path: `/me/messages/${messageId}/move`,
            method: "POST",
            body: { destinationId: dest },
          });

        if (destinationId) {
          try {
            await moveOnce(destinationId);
            return { ok: true, detail };
          } catch (err) {
            // Cached id may be stale — fall through to re-resolve by name
            if (!(err instanceof GraphApiError && err.status === 404)) {
              throw err;
            }
            destinationId = null;
          }
        }

        const resolved = await params.folders.resolve(action.folder);
        await moveOnce(resolved);
        params.onFolderResolved?.(resolved);
        return { ok: true, detail };
      }

      case "forward": {
        await graphRequestWithRetry<void>({
          token,
          path: `/me/messages/${messageId}/forward`,
          method: "POST",
          body: {
            toRecipients: [{ emailAddress: { address: action.to } }],
            ...(action.comment ? { comment: action.comment } : {}),
          },
        });
        if (action.alsoFlag) {
          await graphRequestWithRetry<void>({
            token,
            path: `/me/messages/${messageId}`,
            method: "PATCH",
            body: { flag: { flagStatus: "flagged" } },
          });
        }
        return { ok: true, detail };
      }

      case "flag": {
        await graphRequestWithRetry<void>({
          token,
          path: `/me/messages/${messageId}`,
          method: "PATCH",
          body: { flag: { flagStatus: "flagged" } },
        });
        return { ok: true, detail };
      }

      case "prioritize": {
        await graphRequestWithRetry<void>({
          token,
          path: `/me/messages/${messageId}`,
          method: "PATCH",
          body: { importance: action.importance },
        });
        return { ok: true, detail };
      }

      case "categorize": {
        await graphRequestWithRetry<void>({
          token,
          path: `/me/messages/${messageId}`,
          method: "PATCH",
          body: { categories: action.categories },
        });
        return { ok: true, detail };
      }

      case "reply_draft": {
        // The draft was approved by the user in review — send it.
        await graphRequestWithRetry<void>({
          token,
          path: `/me/messages/${messageId}/reply`,
          method: "POST",
          body: { comment: action.draft },
        });
        return { ok: true, detail: "reply sent" };
      }

      case "none":
        return { ok: true, detail: "no action" };
    }
  } catch (err) {
    return { ok: false, detail, error: getErrorMessage(err) };
  }
}
