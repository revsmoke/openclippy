import type { AgentConfig } from "../config/types.agent.js";

export type ModelConfig = {
  provider: "anthropic";
  model: string;
  apiKey: string;
  maxTokens: number;
};

const DEFAULT_MODEL = "claude-sonnet-4-5-20250514";
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Resolve a ModelConfig from AgentConfig + environment.
 *
 * API key resolution order:
 *   1. config.apiKey (explicit)
 *   2. ANTHROPIC_API_KEY env var
 *   3. throw
 */
export function resolveModelConfig(config: AgentConfig): ModelConfig {
  const apiKey =
    config.apiKey || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Anthropic API key is required. Set agent.apiKey in config or ANTHROPIC_API_KEY environment variable.",
    );
  }

  return {
    provider: "anthropic",
    model: config.model || DEFAULT_MODEL,
    apiKey,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}
