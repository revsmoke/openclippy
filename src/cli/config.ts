import { loadConfig } from "../config/config.js";
import { CONFIG_PATH } from "../config/paths.js";

/** Redact sensitive values (API keys, secrets) in config for display */
function redactConfig(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      result[key] = value;
    } else if (typeof value === "object" && !Array.isArray(value)) {
      result[key] = redactConfig(value as Record<string, unknown>);
    } else if (
      typeof value === "string" &&
      (key.toLowerCase().includes("key") ||
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("password") ||
        key.toLowerCase().includes("token"))
    ) {
      // Redact sensitive string values
      result[key] = value.length > 4
        ? value.slice(0, 4) + "****"
        : "****";
    } else {
      result[key] = value;
    }
  }
  return result;
}

export async function configCommand(opts?: { show?: boolean; setup?: boolean }): Promise<void> {
  if (opts?.setup) {
    const { runSetupWizard } = await import("./wizard.js");
    await runSetupWizard();
    return;
  }

  try {
    // Default behavior: show config (same as --show)
    const config = await loadConfig();

    console.log("OpenClippy Configuration");
    console.log("========================\n");
    console.log(`Config file: ${CONFIG_PATH}\n`);

    // Redact and display
    const redacted = redactConfig(config as unknown as Record<string, unknown>);
    console.log(JSON.stringify(redacted, null, 2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\u274C Failed to load config: ${message}`);
    process.exitCode = 1;
  }
}
