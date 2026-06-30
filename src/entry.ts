import { existsSync } from "node:fs";
import { CONFIG_PATH } from "./config/paths.js";
import { createProgram } from "./cli/program.js";
import { loadDotEnv } from "./config/load-env.js";

export async function main(): Promise<void> {
  // Load project-local .env before anything reads process.env (e.g. the
  // Anthropic API key or Azure overrides). Shell-exported vars still win.
  loadDotEnv();

  const program = createProgram();

  // First-run detection: no config file + no CLI args → auto-launch wizard
  const args = process.argv.slice(2);
  if (args.length === 0 && !existsSync(CONFIG_PATH)) {
    console.log("No configuration found. Starting setup wizard...\n");
    const { runSetupWizard } = await import("./cli/wizard.js");
    await runSetupWizard();
    return;
  }

  await program.parseAsync(process.argv);
}
