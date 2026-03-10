export type ServiceId =
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

export type ServiceConfig = {
  enabled?: boolean;
  pollIntervalMs?: number;
  [key: string]: unknown;
};

export type ServicesConfig = Partial<Record<ServiceId, ServiceConfig>>;
