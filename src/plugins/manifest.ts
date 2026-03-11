import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginManifest } from "./types.js";

type ValidationSuccess = { valid: true; manifest: PluginManifest };
type ValidationFailure = { valid: false; error: string };

/**
 * Validate that `data` conforms to the PluginManifest shape.
 *
 * Returns a discriminated union so callers can branch cleanly on `valid`.
 * Extra fields are silently stripped for forward-compatibility.
 */
export function validateManifest(
  data: unknown,
): ValidationSuccess | ValidationFailure {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { valid: false, error: "Manifest must be a non-null object" };
  }

  const obj = data as Record<string, unknown>;

  // Required string fields
  const requiredStrings: (keyof PluginManifest)[] = [
    "name",
    "version",
    "description",
    "serviceId",
    "entry",
  ];

  for (const field of requiredStrings) {
    if (typeof obj[field] !== "string") {
      return {
        valid: false,
        error: `Missing or invalid field "${field}": expected a string`,
      };
    }
  }

  // serviceId and entry must be non-empty
  if ((obj["serviceId"] as string).trim() === "") {
    return { valid: false, error: 'Field "serviceId" must not be empty' };
  }
  if ((obj["name"] as string).trim() === "") {
    return { valid: false, error: 'Field "name" must not be empty' };
  }
  if ((obj["entry"] as string).trim() === "") {
    return { valid: false, error: 'Field "entry" must not be empty' };
  }

  // entry must be a .js or .mjs file
  const entry = obj["entry"] as string;
  if (!entry.endsWith(".js") && !entry.endsWith(".mjs")) {
    return {
      valid: false,
      error: `Field "entry" must be a .js or .mjs file, got: "${entry}"`,
    };
  }

  // entry must not escape the plugin directory (path traversal prevention)
  if (entry.startsWith("/") || entry.startsWith("\\") || entry.includes("..")) {
    return {
      valid: false,
      error: `Field "entry" must not contain path traversal or absolute paths: "${entry}"`,
    };
  }

  // Optional scopes section
  let scopes: PluginManifest["scopes"] | undefined;
  if (obj["scopes"] !== undefined) {
    if (typeof obj["scopes"] !== "object" || obj["scopes"] === null) {
      return { valid: false, error: '"scopes" must be an object' };
    }

    const scopesObj = obj["scopes"] as Record<string, unknown>;
    scopes = {};

    if (scopesObj["required"] !== undefined) {
      if (
        !Array.isArray(scopesObj["required"]) ||
        !scopesObj["required"].every((s: unknown) => typeof s === "string")
      ) {
        return {
          valid: false,
          error: '"scopes.required" must be an array of strings',
        };
      }
      scopes.required = scopesObj["required"] as string[];
    }

    if (scopesObj["optional"] !== undefined) {
      if (
        !Array.isArray(scopesObj["optional"]) ||
        !scopesObj["optional"].every((s: unknown) => typeof s === "string")
      ) {
        return {
          valid: false,
          error: '"scopes.optional" must be an array of strings',
        };
      }
      scopes.optional = scopesObj["optional"] as string[];
    }
  }

  // Build a clean manifest (strip extra fields)
  const manifest: PluginManifest = {
    name: obj["name"] as string,
    version: obj["version"] as string,
    description: obj["description"] as string,
    serviceId: obj["serviceId"] as string,
    entry: obj["entry"] as string,
    ...(scopes ? { scopes } : {}),
  };

  return { valid: true, manifest };
}

/**
 * Read and validate `manifest.json` from a plugin directory.
 *
 * @throws if the file cannot be read or the manifest is invalid.
 */
export async function readManifest(pluginDir: string): Promise<PluginManifest> {
  const manifestPath = join(pluginDir, "manifest.json");

  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to read manifest.json at ${manifestPath}: ${(err as Error).message}`,
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in manifest.json at ${manifestPath}`);
  }

  const result = validateManifest(data);
  if (!result.valid) {
    throw new Error(
      `Invalid manifest at ${manifestPath}: ${result.error}`,
    );
  }

  return result.manifest;
}
