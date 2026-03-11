export type BuiltinServiceId =
  | "mail"
  | "calendar"
  | "todo"
  | "teams-chat"
  | "onedrive"
  | "planner"
  | "onenote"
  | "sharepoint"
  | "people"
  | "presence";

/** ServiceId is now a string to allow plugin-defined service IDs */
export type ServiceId = string;

export type ServiceConfig = {
  enabled?: boolean;
  pollIntervalMs?: number;
  [key: string]: unknown;
};

export type ServicesConfig = Record<string, ServiceConfig>;
