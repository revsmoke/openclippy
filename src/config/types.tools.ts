export type ToolProfileId = "read-only" | "standard" | "full" | "admin";

export type ToolsConfig = {
  profile?: ToolProfileId;
  allow?: string[];
  deny?: string[];
};
