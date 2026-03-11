import Anthropic from "@anthropic-ai/sdk";
import type { AgentTool, ToolContext, ToolResult } from "../services/types.js";
import { getErrorMessage } from "../services/tool-utils.js";
import type { ModelConfig } from "./model-config.js";
import type { AgentSession } from "./session.js";

// Re-export Anthropic message types we use internally
type MessageParam = Anthropic.Messages.MessageParam;
type ContentBlockParam = Anthropic.Messages.ContentBlockParam;
type ContentBlock = Anthropic.Messages.ContentBlock;

export type AgentRunParams = {
  message: string;
  session: AgentSession;
  modelConfig: ModelConfig;
  tools: AgentTool[];
  systemPrompt: string;
  toolContext: ToolContext;
  maxTurns?: number;
  onToolCall?: (name: string, input: unknown) => void;
  onResponse?: (text: string) => void;
};

const DEFAULT_MAX_TURNS = 10;

/**
 * Convert our AgentTool[] to Anthropic SDK tool format.
 */
function toAnthropicTools(
  tools: AgentTool[],
): Anthropic.Messages.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Messages.Tool.InputSchema,
  }));
}

/**
 * Build the Anthropic messages array from session history.
 *
 * Each AgentMessage maps to a user or assistant message.
 * Tool calls become assistant messages with tool_use content blocks.
 * Tool results become user messages with tool_result content blocks.
 */
function buildMessages(
  session: AgentSession,
): MessageParam[] {
  const messages: MessageParam[] = [];

  for (const msg of session.messages) {
    if (msg.role === "user") {
      // If this user message also carries tool results, combine them
      if (msg.toolResults && msg.toolResults.length > 0) {
        const content: ContentBlockParam[] = msg.toolResults.map((tr) => ({
          type: "tool_result" as const,
          tool_use_id: tr.id,
          content: tr.content,
          is_error: tr.isError,
        }));
        messages.push({ role: "user", content });
      } else {
        messages.push({ role: "user", content: msg.content });
      }
    } else {
      // Assistant message
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        // Assistant message with tool_use blocks (and possibly text)
        const content: ContentBlockParam[] = [];
        if (msg.content) {
          content.push({ type: "text" as const, text: msg.content });
        }
        for (const tc of msg.toolCalls) {
          content.push({
            type: "tool_use" as const,
            id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }
        messages.push({ role: "assistant", content });
      } else {
        messages.push({ role: "assistant", content: msg.content });
      }
    }
  }

  return messages;
}

/**
 * Extract text content from an Anthropic response.
 */
function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Execute a single tool call against the registered tools.
 */
async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  tools: AgentTool[],
  context: ToolContext,
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === toolName);
  if (!tool) {
    return {
      content: `Error: Unknown tool "${toolName}". Available tools: ${tools.map((t) => t.name).join(", ")}`,
      isError: true,
    };
  }

  try {
    return await tool.execute(toolInput, context);
  } catch (err) {
    return {
      content: `Error executing tool "${toolName}": ${getErrorMessage(err)}`,
      isError: true,
    };
  }
}

/**
 * Run the agent loop.
 *
 * 1. Add user message to session
 * 2. Build messages from session history
 * 3. Call Anthropic API
 * 4. If tool_use in response, execute tools and loop
 * 5. When text response received (or max turns), return it
 */
export async function runAgent(params: AgentRunParams): Promise<string> {
  const {
    message,
    session,
    modelConfig,
    tools,
    systemPrompt,
    toolContext,
    maxTurns = DEFAULT_MAX_TURNS,
    onToolCall,
    onResponse,
  } = params;

  const client = new Anthropic({ apiKey: modelConfig.apiKey });
  const anthropicTools = toAnthropicTools(tools);

  // Add the user's message to the session
  session.addUserMessage(message);

  for (let turn = 0; turn < maxTurns; turn++) {
    const messages = buildMessages(session);

    const response = await client.messages.create({
      model: modelConfig.model,
      max_tokens: modelConfig.maxTokens,
      system: systemPrompt,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      messages,
    });

    const textContent = extractText(response.content);

    // Collect any tool_use blocks
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length > 0) {
      // Record assistant message with tool calls
      const toolCalls = toolUseBlocks.map((b) => ({
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      }));

      session.addAssistantMessage(textContent, toolCalls);

      // Execute each tool call
      const toolResults: Array<{
        id: string;
        content: string;
        isError?: boolean;
      }> = [];

      for (const tc of toolUseBlocks) {
        if (onToolCall) {
          onToolCall(tc.name, tc.input);
        }

        const result = await executeTool(
          tc.name,
          tc.input as Record<string, unknown>,
          tools,
          toolContext,
        );

        toolResults.push({
          id: tc.id,
          content: result.content,
          isError: result.isError,
        });
      }

      // Add tool results as a user message (Anthropic protocol)
      session.messages.push({
        role: "user",
        content: "",
        toolResults,
        timestamp: Date.now(),
      });

      // Continue the loop for the next turn
      continue;
    }

    // No tool use — this is the final text response
    session.addAssistantMessage(textContent);

    if (onResponse) {
      onResponse(textContent);
    }

    return textContent;
  }

  // Safety limit reached
  const fallback =
    "I've reached the maximum number of tool-calling turns. Please try rephrasing your request or breaking it into smaller steps.";
  session.addAssistantMessage(fallback);
  return fallback;
}
