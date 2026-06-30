import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Load environment variables from a project-local `.env` file, if one exists.
 *
 * Uses Node's built-in `process.loadEnvFile` (no extra dependency). Variables
 * already present in the real environment take precedence — i.e. an explicit
 * shell `export` wins over the `.env` file, matching the conventional dotenv
 * behaviour. This is what makes `ANTHROPIC_API_KEY`, `OPENCLIPPY_CLIENT_ID`,
 * etc. usable from `.env` without forcing users to export them.
 *
 * Non-fatal by design: a missing or malformed `.env` only logs a warning so the
 * CLI keeps working (e.g. when the key is supplied another way).
 */
export function loadDotEnv(cwd: string = process.cwd()): void {
  const envPath = join(cwd, ".env");
  if (!existsSync(envPath)) return;

  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    console.warn(
      `⚠️  Could not load ${envPath}: ${(err as Error).message}`,
    );
  }
}
