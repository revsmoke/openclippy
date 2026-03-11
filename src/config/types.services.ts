/** Canonical list of built-in service IDs — single source of truth. */
export const BUILTIN_SERVICE_IDS = [
  "mail",
  "calendar",
  "todo",
  "teams-chat",
  "onedrive",
  "planner",
  "onenote",
  "sharepoint",
  "people",
  "presence",
] as const;

export type BuiltinServiceId = (typeof BUILTIN_SERVICE_IDS)[number];

/** ServiceId is now a string to allow plugin-defined service IDs */
export type ServiceId = string;

export type ServiceConfig = {
  enabled?: boolean;
  pollIntervalMs?: number;
  [key: string]: unknown;
};

export type ServicesConfig = Record<string, ServiceConfig>;
