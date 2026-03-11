import { describe, it, expect, afterEach } from "vitest";
import { Readable, Writable } from "node:stream";
import * as readline from "node:readline";
import { readFile, rm, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import { runSetupWizard, discoverPluginOptions } from "./wizard.js";

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

    await runSetupWizard({ rl, configPath, pluginOptions: [] });

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

    await runSetupWizard({ rl, configPath, pluginOptions: [] });

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

    await runSetupWizard({ rl, configPath, pluginOptions: [] });

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

    await runSetupWizard({ rl, configPath, pluginOptions: [] });

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

    await runSetupWizard({ rl, configPath, pluginOptions: [] });

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

    await runSetupWizard({ rl, configPath, pluginOptions: [] });

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

    await runSetupWizard({ rl, configPath, pluginOptions: [] });

    expect(existsSync(configPath)).toBe(true);
    const config = await readSavedConfig(configPath);

    // Agent should have the custom toolProfile (tools section no longer written)
    expect(config.tools).toBeUndefined();

    expect(config).toHaveProperty("agent");
    const agent = config.agent as Record<string, unknown>;
    expect(agent.toolProfile).toBe("full");
  });

  it("wizard with plugin options saves plugin serviceId in config", async () => {
    const configPath = await makeTempConfigPath();

    const pluginOptions = [
      { label: "Jira (plugin)", value: "jira", description: "Jira issues", selected: false },
    ];

    // Select all defaults + toggle jira plugin on (option 11 = jira, the 11th item)
    const rl = createMockRl(
      "",              // clientId — default
      "",              // tenantId — default
      "sk-test-key",   // apiKey
      "1,2,3,4,9,10,11", // services — defaults (1-4,9,10) + jira (11)
      "2",             // toolProfile — standard
      "",              // agentName — default
      "",              // agentEmoji — default
      "",              // gatewayPort — default
      "y",             // save confirm
    );

    await runSetupWizard({ rl, configPath, pluginOptions });

    expect(existsSync(configPath)).toBe(true);
    const config = await readSavedConfig(configPath);

    // Services section should exist because plugin jira differs from defaults
    expect(config).toHaveProperty("services");
    const services = config.services as Record<string, Record<string, unknown>>;

    // Plugin service should be enabled
    expect(services.jira).toBeDefined();
    expect(services.jira.enabled).toBe(true);

    // Built-in defaults should also be present
    expect(services.mail.enabled).toBe(true);
    expect(services.calendar.enabled).toBe(true);
  });

  it("wizard deduplicates plugin serviceIds that collide with builtins", async () => {
    const configPath = await makeTempConfigPath();

    // Plugin with serviceId "mail" collides with builtin
    const pluginOptions = [
      { label: "Mail Enhanced (plugin)", value: "mail", description: "Enhanced mail", selected: false },
      { label: "Jira (plugin)", value: "jira", description: "Jira issues", selected: false },
    ];

    // Only 11 options should appear (10 builtins + 1 jira; mail plugin filtered out)
    // Select defaults + jira (option 11) to verify jira was included but mail plugin was not
    const rl = createMockRl(
      "",              // clientId — default
      "",              // tenantId — default
      "sk-test-key",   // apiKey
      "1,2,3,4,9,10,11", // services — defaults (1-4,9,10) + jira (11)
      "2",             // toolProfile — standard
      "",              // agentName — default
      "",              // agentEmoji — default
      "",              // gatewayPort — default
      "y",             // save confirm
    );

    await runSetupWizard({ rl, configPath, pluginOptions });

    expect(existsSync(configPath)).toBe(true);
    const config = await readSavedConfig(configPath);

    // Services section should exist because jira (enabled) differs from default (no entry)
    expect(config).toHaveProperty("services");
    const services = config.services as Record<string, Record<string, unknown>>;

    // Jira plugin should be enabled (proves it wasn't filtered as a collision)
    expect(services.jira).toBeDefined();
    expect(services.jira.enabled).toBe(true);

    // Mail should be the builtin (enabled), not duplicated
    expect(services.mail.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// discoverPluginOptions tests
// ---------------------------------------------------------------------------

/** Helper: create a valid plugin manifest in a temp dir. */
async function createMockPlugin(
  pluginsDir: string,
  pluginName: string,
  manifest: Record<string, unknown>,
): Promise<void> {
  const pluginDir = join(pluginsDir, pluginName);
  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    join(pluginDir, "manifest.json"),
    JSON.stringify(manifest),
  );
}

describe("discoverPluginOptions", () => {
  it("returns empty array when plugins dir does not exist", async () => {
    const nonexistent = join(tmpdir(), `openclippy-no-exist-${Date.now()}`);
    const options = await discoverPluginOptions(nonexistent);
    expect(options).toEqual([]);
  });

  it("returns empty array when plugins dir is empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openclippy-wizard-plugin-"));
    tempDirs.push(dir);
    const options = await discoverPluginOptions(dir);
    expect(options).toEqual([]);
  });

  it("returns PromptOption[] from valid plugin manifests", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openclippy-wizard-plugin-"));
    tempDirs.push(dir);

    await createMockPlugin(dir, "jira-plugin", {
      name: "Jira Integration",
      version: "1.0.0",
      description: "Manage Jira issues",
      serviceId: "jira",
      entry: "index.js",
    });

    const options = await discoverPluginOptions(dir);

    expect(options).toHaveLength(1);
    expect(options[0].label).toBe("Jira Integration (plugin)");
    expect(options[0].value).toBe("jira");
    expect(options[0].description).toBe("Manage Jira issues");
  });

  it("sets selected: false for all plugin options", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openclippy-wizard-plugin-"));
    tempDirs.push(dir);

    await createMockPlugin(dir, "slack-plugin", {
      name: "Slack",
      version: "1.0.0",
      description: "Slack messages",
      serviceId: "slack",
      entry: "index.js",
    });

    const options = await discoverPluginOptions(dir);

    expect(options).toHaveLength(1);
    expect(options[0].selected).toBe(false);
  });

  it("skips plugins with invalid manifests without crashing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openclippy-wizard-plugin-"));
    tempDirs.push(dir);

    // Valid plugin
    await createMockPlugin(dir, "good-plugin", {
      name: "Good Plugin",
      version: "1.0.0",
      description: "Works great",
      serviceId: "good",
      entry: "index.js",
    });

    // Invalid plugin (missing required fields)
    await createMockPlugin(dir, "bad-plugin", {
      name: "Bad Plugin",
      // missing serviceId, entry, etc.
    });

    const options = await discoverPluginOptions(dir);

    // Should only include the valid plugin, skipping the bad one
    expect(options).toHaveLength(1);
    expect(options[0].value).toBe("good");
  });

  it("discovers multiple plugins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openclippy-wizard-plugin-"));
    tempDirs.push(dir);

    await createMockPlugin(dir, "plugin-a", {
      name: "Plugin A",
      version: "1.0.0",
      description: "First plugin",
      serviceId: "plugin-a",
      entry: "index.js",
    });

    await createMockPlugin(dir, "plugin-b", {
      name: "Plugin B",
      version: "2.0.0",
      description: "Second plugin",
      serviceId: "plugin-b",
      entry: "index.js",
    });

    const options = await discoverPluginOptions(dir);

    expect(options).toHaveLength(2);
    const values = options.map((o) => o.value).sort();
    expect(values).toEqual(["plugin-a", "plugin-b"]);
  });

  it("uses manifest name as label with (plugin) suffix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openclippy-wizard-plugin-"));
    tempDirs.push(dir);

    await createMockPlugin(dir, "my-svc", {
      name: "My Custom Service",
      version: "1.0.0",
      description: "Does custom things",
      serviceId: "my-svc",
      entry: "index.js",
    });

    const options = await discoverPluginOptions(dir);

    expect(options[0].label).toBe("My Custom Service (plugin)");
    expect(options[0].description).toBe("Does custom things");
    expect(options[0].value).toBe("my-svc");
  });
});
