import { Command } from "commander";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("openclippy")
    .description("Autonomous AI work agent for Microsoft 365")
    .version("0.1.0");

  program
    .command("login")
    .description("Authenticate with Microsoft 365")
    .action(async () => {
      const { loginCommand } = await import("./login.js");
      await loginCommand();
    });

  program
    .command("status")
    .description("Show authentication and service status")
    .action(async () => {
      const { statusCommand } = await import("./status.js");
      await statusCommand();
    });

  program
    .command("ask <message>")
    .description("Ask Clippy a question (one-shot)")
    .action(async (message: string) => {
      const { askCommand } = await import("./ask.js");
      await askCommand(message);
    });

  program
    .command("services")
    .description("List enabled M365 services and scopes")
    .action(async () => {
      const { servicesCommand } = await import("./services.js");
      await servicesCommand();
    });

  program
    .command("chat")
    .description("Start an interactive chat session with Clippy")
    .action(async () => {
      const { chatCommand } = await import("./chat.js");
      await chatCommand();
    });

  program
    .command("config")
    .description("Show or edit configuration")
    .option("--show", "Show current configuration")
    .option("--setup", "Run the configuration wizard")
    .action(async (opts: { show?: boolean; setup?: boolean }) => {
      const { configCommand } = await import("./config.js");
      await configCommand(opts);
    });

  // Gateway subcommand with start/stop/status
  const gateway = program
    .command("gateway")
    .description("Manage the OpenClippy gateway daemon");

  gateway
    .command("start")
    .description("Start the gateway daemon")
    .action(async () => {
      const { gatewayStartCommand } = await import("./gateway.js");
      await gatewayStartCommand();
    });

  gateway
    .command("stop")
    .description("Stop the running gateway daemon")
    .action(async () => {
      const { gatewayStopCommand } = await import("./gateway.js");
      await gatewayStopCommand();
    });

  gateway
    .command("status")
    .description("Check gateway daemon status")
    .action(async () => {
      const { gatewayStatusCommand } = await import("./gateway.js");
      await gatewayStatusCommand();
    });

  return program;
}
