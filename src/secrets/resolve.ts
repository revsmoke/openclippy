import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import type { SecretInput } from "../config/types.secrets.js";

/** Resolve a SecretInput to its string value */
export async function resolveSecret(input: SecretInput | undefined): Promise<string | undefined> {
  if (input === undefined || input === null) return undefined;

  // Plain string — return as-is
  if (typeof input === "string") return input;

  switch (input.source) {
    case "env":
      return process.env[input.key];

    case "file":
      try {
        return (await readFile(input.path, "utf-8")).trim();
      } catch {
        return undefined;
      }

    case "exec":
      // NOTE: execSync is used intentionally here. The command comes from the
      // user's own config file (e.g. "op read ...", "aws secretsmanager ..."),
      // not from untrusted input. Shell execution is required for these tools.
      try {
        return execSync(input.command, { encoding: "utf-8", timeout: 10000 }).trim();
      } catch {
        return undefined;
      }

    default:
      return undefined;
  }
}
