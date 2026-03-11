import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ServiceModule } from "../services/types.js";
import type { PluginLoadResult } from "./types.js";
import { readManifest } from "./manifest.js";

/**
 * Validate that an object has the ServiceModule shape at runtime.
 * We can't trust TypeScript types for dynamically-imported external code.
 */
export function validateServiceModule(obj: unknown): obj is ServiceModule {
  if (obj === null || obj === undefined || typeof obj !== "object") {
    return false;
  }

  const candidate = obj as Record<string, unknown>;

  // id must be a string
  if (typeof candidate["id"] !== "string") {
    return false;
  }

  // tools must be a function
  if (typeof candidate["tools"] !== "function") {
    return false;
  }

  // meta must be an object with label (string), description (string), requiredScopes (array)
  if (
    candidate["meta"] === null ||
    candidate["meta"] === undefined ||
    typeof candidate["meta"] !== "object"
  ) {
    return false;
  }
  const meta = candidate["meta"] as Record<string, unknown>;
  if (typeof meta["label"] !== "string") return false;
  if (typeof meta["description"] !== "string") return false;
  if (!Array.isArray(meta["requiredScopes"])) return false;

  // capabilities must be an object with read, write, delete, search, subscribe (all boolean)
  if (
    candidate["capabilities"] === null ||
    candidate["capabilities"] === undefined ||
    typeof candidate["capabilities"] !== "object"
  ) {
    return false;
  }
  const caps = candidate["capabilities"] as Record<string, unknown>;
  for (const key of ["read", "write", "delete", "search", "subscribe"]) {
    if (typeof caps[key] !== "boolean") return false;
  }

  // Optional: status?.probe must be a function if present
  if (candidate["status"] !== undefined) {
    if (
      candidate["status"] === null ||
      typeof candidate["status"] !== "object"
    ) {
      return false;
    }
    const status = candidate["status"] as Record<string, unknown>;
    if (typeof status["probe"] !== "function") return false;
  }

  // Optional: promptHints must be a function if present
  if (
    candidate["promptHints"] !== undefined &&
    typeof candidate["promptHints"] !== "function"
  ) {
    return false;
  }

  // Optional: subscriptions must have resources (array), changeTypes (array), handle (function)
  if (candidate["subscriptions"] !== undefined) {
    if (
      candidate["subscriptions"] === null ||
      typeof candidate["subscriptions"] !== "object"
    ) {
      return false;
    }
    const subs = candidate["subscriptions"] as Record<string, unknown>;
    if (!Array.isArray(subs["resources"])) return false;
    if (!Array.isArray(subs["changeTypes"])) return false;
    if (typeof subs["handle"] !== "function") return false;
  }

  return true;
}

/**
 * Load a plugin from a directory.
 * Reads manifest, imports the entry module, validates the shape.
 */
export async function loadPlugin(
  pluginDir: string,
): Promise<PluginLoadResult> {
  // 1. Read manifest (readManifest handles validation)
  const manifest = await readManifest(pluginDir);

  // 2. Build entry path and verify it stays inside the plugin directory (path traversal defense)
  const entryPath = join(pluginDir, manifest.entry);
  const resolvedEntry = resolve(entryPath);
  const resolvedPlugin = resolve(pluginDir);
  if (!resolvedEntry.startsWith(resolvedPlugin + "/")) {
    throw new Error(
      `Plugin entry path "${manifest.entry}" escapes plugin directory ${pluginDir}`,
    );
  }
  const entryUrl = pathToFileURL(resolvedEntry).href;

  // 3. Dynamic import
  let imported: Record<string, unknown>;
  try {
    imported = (await import(entryUrl)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Failed to import plugin entry at ${entryPath}: ${(err as Error).message}`,
    );
  }

  // 4. Get the default export (or the module itself)
  const moduleObj: unknown =
    "default" in imported ? imported["default"] : imported;

  // 5. Validate shape with validateServiceModule
  if (!validateServiceModule(moduleObj)) {
    throw new Error(
      `Plugin at ${pluginDir} does not export a valid ServiceModule shape`,
    );
  }

  // 6. Verify id matches manifest.serviceId
  if (moduleObj.id !== manifest.serviceId) {
    throw new Error(
      `Plugin id mismatch: module exports id "${moduleObj.id}" but manifest declares serviceId "${manifest.serviceId}"`,
    );
  }

  // 7. Return { manifest, path, module }
  return {
    manifest,
    path: pluginDir,
    module: moduleObj,
  };
}
