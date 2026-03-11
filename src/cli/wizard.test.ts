import { describe, it, expect, afterEach } from "vitest";
import { Readable, Writable } from "node:stream";
import * as readline from "node:readline";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import { runSetupWizard } from "./wizard.js";

/**
 * Creates a mock readline.Interface that feeds answers on demand.
 * Lines are pushed one at a time each time the readable stream is read,
 * preventing the stream from closing before all answers are consumed.
 */
function createMockRl(...answers: string[]): readline.Interface {
  const queue = [...answers];
  const input = new Readable({
    read() {
      // Use setImmediate to allow the readline to process the previous
      // line before we push the next one.
      setImmediate(() => {
        if (queue.length > 0) {
          this.push(queue.shift()! + "\n");
        } else {
          this.push(null);
        }
      });
    },
  });
  return readline.createInterface({
    input,
    output: new Writable({ write(_, __, cb) { cb(); } }),
  });
}

/**
 * Helper: read and parse the saved YAML config file.
 */
async function readSavedConfig(configPath: string): Promise<Record<string, unknown>> {
  const raw = await readFile(configPath, "utf-8");
  return parseYaml(raw) as Record<string, unknown>;
}

// Track temp dirs for cleanup
let tempDirs: string[] = [];

async function makeTempConfigPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "openclippy-wizard-test-"));
  tempDirs.push(dir);
  return join(dir, "config.yaml");
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

/**
 * Answer sequence for wizard steps:
 *  1. clientId       (text, default: built-in)
 *  2. tenantId       (text, default: built-in)
 *  3. apiKey          (text, no default)
 *  4. services       (multiSelect, default: mail,calendar,todo,teams-chat,people,presence)
 *  5. toolProfile    (select, default: standard = option 2)
 *  6. agentName      (text, default: "Clippy")
 *  7. agentEmoji     (text, default: "📎")
 *  8. gatewayPort    (text, default: "4100")
 *  9. saveConfirm    (confirm y/n)
 */

describe("runSetupWizard", () => {
  it("wizard with all defaults produces minimal config (only apiKey)", async () => {
    const configPath = await makeTempConfigPath();

    // All defaults except apiKey (required) and save confirm
    const rl = createMockRl(
      "",              // clientId — default
      "",              // tenantId — default
      "sk-test-key",   // apiKey — required
      "",              // services — defaults
      "2",             // toolProfile — standard (option 2)
      "",              // agentName — default "Clippy"
      "",              // agentEmoji — default "📎"
      "",              // gatewayPort — default "4100"
      "y",             // save confirm
    );

    await runSetupWizard({ rl, configPath });

    expect(existsSync(configPath)).toBe(true);
    const config = await readSavedConfig(configPath);

    // Only apiKey should be saved since everything else matches defaults
    expect(config).toHaveProperty("agent");
    const agent = config.agent as Record<string, unknown>;
    expect(agent.apiKey).toBe("sk-test-key");

    // Should NOT have azure section (defaults match)
    expect(config.azure).toBeUndefined();
    // Should NOT have services section (defaults match)
    expect(config.services).toBeUndefined();
    // Should NOT have tools section (defaults match)
    expect(config.tools).toBeUndefined();
    // Should NOT have gateway section (defaults match)
    expect(config.gateway).toBeUndefined();
  });

  it("wizard with custom clientId saves it", async () => {
    const configPath = await makeTempConfigPath();

    const rl = createMockRl(
      "my-custom-id",  // clientId — custom
      "",              // tenantId — default
      "sk-test-key",   // apiKey
      "",              // services — defaults
      "2",             // toolProfile — standard
      "",              // agentName — default
      "",              // agentEmoji — default
      "",              // gatewayPort — default
      "y",             // save confirm
    );

    await runSetupWizard({ rl, configPath });

    expect(existsSync(configPath)).toBe(true);
    const config = await readSavedConfig(configPath);

    // Azure section should have the custom clientId
    expect(config).toHaveProperty("azure");
    const azure = config.azure as Record<string, unknown>;
    expect(azure.clientId).toBe("my-custom-id");

    // apiKey should be saved
    const agent = config.agent as Record<string, unknown>;
    expect(agent.apiKey).toBe("sk-test-key");
  });

  it("wizard with services toggled saves correct config", async () => {
    const configPath = await makeTempConfigPath();

    const rl = createMockRl(
      "",              // clientId — default
      "",              // tenantId — default
      "sk-test-key",   // apiKey
      "1,2",           // services — only mail, calendar selected
      "2",             // toolProfile — standard
      "",              // agentName — default
      "",              // agentEmoji — default
      "",              // gatewayPort — default
      "y",             // save confirm
    );

    await runSetupWizard({ rl, configPath });

    expect(existsSync(configPath)).toBe(true);
    const config = await readSavedConfig(configPath);

    // Services section should exist with non-default selections
    expect(config).toHaveProperty("services");
    const services = config.services as Record<string, Record<string, unknown>>;

    // mail and calendar should be enabled
    expect(services.mail.enabled).toBe(true);
    expect(services.calendar.enabled).toBe(true);

    // The rest should be disabled (including todo, teams-chat, people, presence
    // which are defaults but NOT selected here)
    expect(services.todo.enabled).toBe(false);
    expect(services["teams-chat"].enabled).toBe(false);
    expect(services.onedrive.enabled).toBe(false);
    expect(services.planner.enabled).toBe(false);
    expect(services.onenote.enabled).toBe(false);
    expect(services.sharepoint.enabled).toBe(false);
    expect(services.people.enabled).toBe(false);
    expect(services.presence.enabled).toBe(false);
  });

  it("wizard with custom identity saves it", async () => {
    const configPath = await makeTempConfigPath();

    const rl = createMockRl(
      "",              // clientId — default
      "",              // tenantId — default
      "sk-test-key",   // apiKey
      "",              // services — defaults
      "2",             // toolProfile — standard
      "Cortana",       // agentName — custom
      "\u{1F916}",     // agentEmoji — custom robot emoji
      "",              // gatewayPort — default
      "y",             // save confirm
    );

    await runSetupWizard({ rl, configPath });

    expect(existsSync(configPath)).toBe(true);
    const config = await readSavedConfig(configPath);

    // Agent identity should be saved
    expect(config).toHaveProperty("agent");
    const agent = config.agent as Record<string, unknown>;
    const identity = agent.identity as Record<string, unknown>;
    expect(identity.name).toBe("Cortana");
    expect(identity.emoji).toBe("\u{1F916}");
  });

  it("wizard with custom port saves it", async () => {
    const configPath = await makeTempConfigPath();

    const rl = createMockRl(
      "",              // clientId — default
      "",              // tenantId — default
      "sk-test-key",   // apiKey
      "",              // services — defaults
      "2",             // toolProfile — standard
      "",              // agentName — default
      "",              // agentEmoji — default
      "8080",          // gatewayPort — custom
      "y",             // save confirm
    );

    await runSetupWizard({ rl, configPath });

    expect(existsSync(configPath)).toBe(true);
    const config = await readSavedConfig(configPath);

    // Gateway section should have custom port
    expect(config).toHaveProperty("gateway");
    const gateway = config.gateway as Record<string, unknown>;
    expect(gateway.port).toBe(8080);
  });

  it("wizard save confirmation 'n' does not write file", async () => {
    const configPath = await makeTempConfigPath();

    const rl = createMockRl(
      "",              // clientId — default
      "",              // tenantId — default
      "sk-test-key",   // apiKey
      "",              // services — defaults
      "2",             // toolProfile — standard
      "",              // agentName — default
      "",              // agentEmoji — default
      "",              // gatewayPort — default
      "n",             // save confirm — NO
    );

    await runSetupWizard({ rl, configPath });

    // File should NOT exist
    expect(existsSync(configPath)).toBe(false);
  });

  it("wizard with custom tool profile saves it", async () => {
    const configPath = await makeTempConfigPath();

    const rl = createMockRl(
      "",              // clientId — default
      "",              // tenantId — default
      "sk-test-key",   // apiKey
      "",              // services — defaults
      "3",             // toolProfile — full (option 3)
      "",              // agentName — default
      "",              // agentEmoji — default
      "",              // gatewayPort — default
      "y",             // save confirm
    );

    await runSetupWizard({ rl, configPath });

    expect(existsSync(configPath)).toBe(true);
    const config = await readSavedConfig(configPath);

    // Agent should have the custom toolProfile (tools section no longer written)
    expect(config.tools).toBeUndefined();

    expect(config).toHaveProperty("agent");
    const agent = config.agent as Record<string, unknown>;
    expect(agent.toolProfile).toBe("full");
  });
});
