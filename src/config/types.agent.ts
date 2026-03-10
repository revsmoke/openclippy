export type IdentityConfig = {
  name?: string;
  emoji?: string;
};

export type AgentConfig = {
  model?: string;
  toolProfile?: string;
  identity?: IdentityConfig;
  apiKey?: string;
};
