import type { ServiceId } from "../config/types.services.js";

/** Input/output context for tool execution */
export type ToolContext = {
  token: string;
  userId?: string;
  timezone?: string;
};

/** Structured tool result */
export type ToolResult = {
  content: string;
  isError?: boolean;
};

/** A single tool exposed by a service module */
export type AgentTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema object
  execute: (
    input: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<ToolResult>;
};

/** Capability flags for a service module */
export type ServiceCapabilities = {
  read: boolean;
  write: boolean;
  delete: boolean;
  search: boolean;
  /** Whether the service supports Graph change notifications */
  subscribe: boolean;
};

/** Metadata about a service module */
export type ServiceMeta = {
  label: string;
  description: string;
  requiredScopes: string[];
  optionalScopes?: string[];
};

/** Probe result for service health check */
export type ProbeResult = {
  ok: boolean;
  error?: string;
};

/**
 * A pluggable M365 service module.
 *
 * Each Graph service (mail, calendar, todo, etc.) implements this interface
 * to expose tools to the AI agent. Replaces OpenClaw's ChannelPlugin concept.
 */
export type ServiceModule = {
  id: ServiceId;
  meta: ServiceMeta;
  capabilities: ServiceCapabilities;

  /** Return the tools this service exposes */
  tools: () => AgentTool[];

  /** Optional health probe */
  status?: {
    probe: (params: { token: string }) => Promise<ProbeResult>;
  };

  /** Optional Graph change notification subscriptions */
  subscriptions?: {
    resources: string[]; // e.g. ["/me/messages"]
    changeTypes: string[]; // ["created", "updated"]
    handle: (notification: unknown) => Promise<void>;
  };

  /** Optional context hints injected into the agent system prompt */
  promptHints?: () => string[];
};
