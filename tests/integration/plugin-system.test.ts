/**
 * Integration test: Plugin System
 *
 * Verifies the full plugin lifecycle end-to-end:
 *   disk plugin -> PluginRegistry.loadAll -> ServiceRegistry -> tools + probes
 *
 * Creates real plugin files on disk in a temp directory, loads them through
 * the real PluginRegistry, and checks that everything wires up correctly.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ServiceRegistry } from "../../src/services/registry.js";
import { ScopeManager } from "../../src/auth/scope-manager.js";
import { PluginRegistry } from "../../src/plugins/registry.js";
import { filterToolsByProfile } from "../../src/agents/tool-profiles.js";
import type { ServicesConfig } from "../../src/config/types.services.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a valid test plugin on disk with the given serviceId and tool names.
 *
 * The plugin exports a valid ServiceModule with the specified tools.
 * Each tool's execute returns `{ content: "result-from-<name>" }`.
 */
async function createTestPlugin(
  dir: string,
  serviceId: string,
  tools: string[],
): Promise<void> {
  await mkdir(dir, { recursive: true });

  const toolDefs = tools
    .map(
      (name) => `{
      name: "${name}",
      description: "Test tool ${name}",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ content: "result-from-${name}" }),
    }`,
    )
    .join(",\n    ");

  await writeFile(
    join(dir, "manifest.json"),
    JSON.stringify({
      name: serviceId,
      version: "1.0.0",
      description: `Test plugin ${serviceId}`,
      serviceId,
      entry: "index.js",
      scopes: { required: ["Custom.Read"], optional: [] },
    }),
  );

  await writeFile(
    join(dir, "index.js"),
    `export default {
  id: "${serviceId}",
  meta: { label: "${serviceId}", description: "Test plugin", requiredScopes: ["Custom.Read"] },
  capabilities: { read: true, write: true, delete: false, search: false, subscribe: false },
  tools: () => [
    ${toolDefs}
  ],
  status: { probe: async () => ({ ok: true }) },
};
`,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Plugin System Integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "plugin-integration-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. End-to-end: Create plugin on disk -> load -> verify tools appear
  // -------------------------------------------------------------------------
  it("loads a plugin from disk and registers tools in ServiceRegistry", async () => {
    // Create the plugin on disk
    const pluginDir = join(tempDir, "integration-test");
    await createTestPlugin(pluginDir, "integration-test", [
      "integration_test_list",
      "integration_test_create",
    ]);

    // Set up registries
    const serviceRegistry = new ServiceRegistry();
    const scopeManager = new ScopeManager();
    const pluginRegistry = new PluginRegistry(serviceRegistry, scopeManager);

    // Load all plugins from the temp directory
    const { loaded, errors } = await pluginRegistry.loadAll({
      pluginsDir: tempDir,
    });

    // Verify no errors
    expect(errors).toHaveLength(0);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].manifest.serviceId).toBe("integration-test");

    // Verify the module is retrievable from ServiceRegistry
    const mod = serviceRegistry.get("integration-test");
    expect(mod).toBeDefined();
    expect(mod!.id).toBe("integration-test");

    // Verify tools appear in getAllTools when the service is enabled
    const config: ServicesConfig = {
      "integration-test": { enabled: true },
    };
    const tools = serviceRegistry.getAllTools(config);
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain("integration_test_list");
    expect(toolNames).toContain("integration_test_create");
    expect(tools).toHaveLength(2);

    // Verify scopes were registered
    const scopes = scopeManager.computeRequiredScopes(["integration-test"]);
    expect(scopes).toContain("Custom.Read");
  });

  // -------------------------------------------------------------------------
  // 2. Plugin tools are filtered by tool profiles
  // -------------------------------------------------------------------------
  it("filters plugin tools correctly by tool profiles", async () => {
    const pluginDir = join(tempDir, "profile-test");
    await createTestPlugin(pluginDir, "profile-test", [
      "test_list",
      "test_create",
    ]);

    const serviceRegistry = new ServiceRegistry();
    const scopeManager = new ScopeManager();
    const pluginRegistry = new PluginRegistry(serviceRegistry, scopeManager);

    await pluginRegistry.loadAll({ pluginsDir: tempDir });

    const config: ServicesConfig = {
      "profile-test": { enabled: true },
    };
    const allTools = serviceRegistry.getAllTools(config);
    expect(allTools).toHaveLength(2);

    // read-only: test_list passes (matches *_list), test_create blocked (matches *_create)
    const readOnly = filterToolsByProfile(allTools, "read-only");
    const readOnlyNames = readOnly.map((t) => t.name);
    expect(readOnlyNames).toContain("test_list");
    expect(readOnlyNames).not.toContain("test_create");

    // standard: both pass (test_list matches *, test_create matches *; neither ends in _delete)
    const standard = filterToolsByProfile(allTools, "standard");
    const standardNames = standard.map((t) => t.name);
    expect(standardNames).toContain("test_list");
    expect(standardNames).toContain("test_create");

    // full: both pass (everything allowed, nothing blocked)
    const full = filterToolsByProfile(allTools, "full");
    const fullNames = full.map((t) => t.name);
    expect(fullNames).toContain("test_list");
    expect(fullNames).toContain("test_create");
  });

  // -------------------------------------------------------------------------
  // 3. Plugin tools execute correctly
  // -------------------------------------------------------------------------
  it("executes plugin tool and returns correct result", async () => {
    const pluginDir = join(tempDir, "exec-test");
    await createTestPlugin(pluginDir, "exec-test", ["exec_test_list"]);

    const serviceRegistry = new ServiceRegistry();
    const scopeManager = new ScopeManager();
    const pluginRegistry = new PluginRegistry(serviceRegistry, scopeManager);

    await pluginRegistry.loadAll({ pluginsDir: tempDir });

    const config: ServicesConfig = {
      "exec-test": { enabled: true },
    };
    const tools = serviceRegistry.getAllTools(config);
    expect(tools).toHaveLength(1);

    const tool = tools[0];
    expect(tool.name).toBe("exec_test_list");

    // Execute the tool and verify the result
    const result = await tool.execute(
      {},
      { token: "fake-token", userId: "user-1", timezone: "UTC" },
    );
    expect(result).toEqual({ content: "result-from-exec_test_list" });
  });

  // -------------------------------------------------------------------------
  // 4. Plugin health probes run correctly
  // -------------------------------------------------------------------------
  it("runs plugin health probe and returns expected result", async () => {
    const pluginDir = join(tempDir, "probe-test");
    await createTestPlugin(pluginDir, "probe-test", ["probe_test_list"]);

    const serviceRegistry = new ServiceRegistry();
    const scopeManager = new ScopeManager();
    const pluginRegistry = new PluginRegistry(serviceRegistry, scopeManager);

    await pluginRegistry.loadAll({ pluginsDir: tempDir });

    // Verify the module has a probe
    const mod = serviceRegistry.get("probe-test");
    expect(mod).toBeDefined();
    expect(mod!.status).toBeDefined();
    expect(typeof mod!.status!.probe).toBe("function");

    // Call the probe directly
    const probeResult = await mod!.status!.probe({ token: "fake-token" });
    expect(probeResult).toEqual({ ok: true });

    // Also verify via probeAll on ServiceRegistry
    const config: ServicesConfig = {
      "probe-test": { enabled: true },
    };
    const probeResults = await serviceRegistry.probeAll({
      token: "fake-token",
      config,
    });
    expect(probeResults.get("probe-test")).toEqual({ ok: true });
  });

  // -------------------------------------------------------------------------
  // 5. Bad plugin doesn't crash startup
  // -------------------------------------------------------------------------
  it("loads good plugins and collects errors for bad plugins without crashing", async () => {
    // Create a good plugin
    const goodDir = join(tempDir, "good-plugin");
    await createTestPlugin(goodDir, "good-plugin", ["good_list"]);

    // Create a bad plugin with malformed manifest.json
    const badDir = join(tempDir, "bad-plugin");
    await mkdir(badDir, { recursive: true });
    await writeFile(join(badDir, "manifest.json"), "{ this is not valid JSON }");

    const serviceRegistry = new ServiceRegistry();
    const scopeManager = new ScopeManager();
    const pluginRegistry = new PluginRegistry(serviceRegistry, scopeManager);

    // loadAll should NOT throw
    const { loaded, errors } = await pluginRegistry.loadAll({
      pluginsDir: tempDir,
    });

    // Good plugin loaded successfully
    expect(loaded).toHaveLength(1);
    expect(loaded[0].manifest.serviceId).toBe("good-plugin");

    // Bad plugin is in errors
    expect(errors).toHaveLength(1);
    expect(errors[0].pluginPath).toContain("bad-plugin");
    expect(errors[0].error).toBeTruthy();

    // Good plugin's tools are available
    const config: ServicesConfig = {
      "good-plugin": { enabled: true },
    };
    const tools = serviceRegistry.getAllTools(config);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("good_list");

    // Bad plugin is NOT registered
    const badMod = serviceRegistry.get("bad-plugin");
    expect(badMod).toBeUndefined();
  });
});
