/** A secret that can be resolved from different sources */
export type SecretInput =
  | string
  | { source: "env"; key: string }
  | { source: "file"; path: string }
  | { source: "exec"; command: string };
