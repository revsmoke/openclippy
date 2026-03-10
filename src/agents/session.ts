import { randomUUID } from "node:crypto";

export type AgentMessage = {
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  toolResults?: Array<{
    id: string;
    content: string;
    isError?: boolean;
  }>;
  timestamp: number;
};

/**
 * Manages conversation state for an agent session.
 *
 * Tracks user and assistant messages, including tool calls and results,
 * providing the history needed to build Anthropic API message arrays.
 */
export class AgentSession {
  readonly id: string;
  messages: AgentMessage[];

  constructor(id?: string) {
    this.id = id ?? randomUUID();
    this.messages = [];
  }

  addUserMessage(content: string): void {
    this.messages.push({
      role: "user",
      content,
      timestamp: Date.now(),
    });
  }

  addAssistantMessage(
    content: string,
    toolCalls?: AgentMessage["toolCalls"],
    toolResults?: AgentMessage["toolResults"],
  ): void {
    this.messages.push({
      role: "assistant",
      content,
      toolCalls,
      toolResults,
      timestamp: Date.now(),
    });
  }

  getHistory(): AgentMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }
}
