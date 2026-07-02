export type IdentityConfig = {
  name?: string;
  emoji?: string;
};

export type AgentConfig = {
  model?: string;
  /**
   * Tool profile written by the setup wizard. `tools.profile` is the canonical
   * field and wins when both are set; this is honored as a fallback via
   * getToolProfile(). See src/config/helpers.ts.
   */
  toolProfile?: string;
  identity?: IdentityConfig;
  apiKey?: string;
};
