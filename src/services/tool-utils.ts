/**
 * Shared helper functions for service tool implementations.
 *
 * Centralises common patterns (parameter validation, error formatting,
 * date/size formatting) that were previously duplicated across
 * individual service tool files.
 */
import type { ToolResult } from "./types.js";

// ---------------------------------------------------------------------------
// Parameter validation
// ---------------------------------------------------------------------------

/** Return an error ToolResult for a missing required parameter. */
export function missingParam(name: string): ToolResult {
  return { content: `Missing required parameter: ${name}`, isError: true };
}

/** Return an error ToolResult with an "Error: " prefix. */
export function errorResult(message: string): ToolResult {
  return { content: `Error: ${message}`, isError: true };
}

/**
 * Validate that a required string param is present and non-empty.
 * Returns the trimmed string on success, or a ToolResult error.
 */
export function requireString(
  input: Record<string, unknown>,
  key: string,
): string | ToolResult {
  const val = input[key];
  if (typeof val !== "string" || val.trim() === "") {
    return missingParam(key);
  }
  return val.trim();
}

/**
 * Validate that a required array param is present and non-empty.
 * Returns the array on success, or a ToolResult error.
 */
export function requireArray(
  input: Record<string, unknown>,
  key: string,
): unknown[] | ToolResult {
  const val = input[key];
  if (!Array.isArray(val) || val.length === 0) {
    return missingParam(key);
  }
  return val;
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/** Extract a message string from an unknown caught value. */
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

/**
 * Format an ISO date string to a short human-readable date
 * (e.g. "Jan 15, 2025"). Returns "unknown" when undefined.
 */
export function formatShortDate(iso?: string): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format an ISO date string to a medium date with short time
 * (e.g. "Jan 15, 2025, 2:30 PM"). Returns the original string on failure.
 */
export function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/**
 * Extract the date-only portion (YYYY-MM-DD) from an ISO string
 * by splitting on 'T'. Returns undefined when input is undefined.
 */
export function formatDateOnly(dt?: string): string | undefined {
  if (!dt) return undefined;
  return dt.split("T")[0];
}

// ---------------------------------------------------------------------------
// Size formatting
// ---------------------------------------------------------------------------

/**
 * Format a byte count to a human-readable size string.
 * Returns "unknown" when undefined or zero.
 */
export function formatFileSize(bytes?: number): string {
  if (!bytes) return "unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
