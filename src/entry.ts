import { existsSync } from "node:fs";
import { CONFIG_PATH } from "./config/paths.js";
import { createProgram } from "./cli/program.js";

export async function main(): Promise<void> {
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
