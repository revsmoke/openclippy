import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { scanPluginDirs } from "./scanner.js";

/**
 * Helper: create a unique temp directory for each test.
 * Returns the absolute path; caller is responsible for cleanup.
 */
async function makeTempDir(): Promise<string> {
  const dir = join(tmpdir(), `openclippy-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Minimal valid manifest JSON content */
const MANIFEST_JSON = JSON.stringify({
  name: "test-plugin",
  version: "1.0.0",
  description: "A test plugin",
  serviceId: "test-service",
  entry: "./index.js",
});

// ---------------------------------------------------------------------------
// scanPluginDirs
// ---------------------------------------------------------------------------
describe("scanPluginDirs", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanupDirs.map((d) => rm(d, { recursive: true, force: true })),
    );
    cleanupDirs.length = 0;
  });

  it("returns empty array when plugins dir doesn't exist", async () => {
    const missing = join(tmpdir(), `nonexistent-${randomUUID()}`);
    const result = await scanPluginDirs({ pluginsDir: missing });
    expect(result).toEqual([]);
  });

  it("returns empty array when plugins dir is empty", async () => {
    const dir = await makeTempDir();
    cleanupDirs.push(dir);

    const result = await scanPluginDirs({ pluginsDir: dir });
    expect(result).toEqual([]);
  });

  it("discovers directories with manifest.json inside them", async () => {
    const dir = await makeTempDir();
    cleanupDirs.push(dir);

    // Create two valid plugin dirs
    const pluginA = join(dir, "plugin-a");
    const pluginB = join(dir, "plugin-b");
    await mkdir(pluginA);
    await mkdir(pluginB);
    await writeFile(join(pluginA, "manifest.json"), MANIFEST_JSON);
    await writeFile(join(pluginB, "manifest.json"), MANIFEST_JSON);

    const result = await scanPluginDirs({ pluginsDir: dir });
    expect(result).toHaveLength(2);
    expect(result).toContain(pluginA);
    expect(result).toContain(pluginB);
  });

  it("skips directories without manifest.json", async () => {
    const dir = await makeTempDir();
    cleanupDirs.push(dir);

    // One valid, one missing manifest
    const valid = join(dir, "valid-plugin");
    const noManifest = join(dir, "no-manifest");
    await mkdir(valid);
    await mkdir(noManifest);
    await writeFile(join(valid, "manifest.json"), MANIFEST_JSON);
    // noManifest has no manifest.json

    const result = await scanPluginDirs({ pluginsDir: dir });
    expect(result).toEqual([valid]);
  });

  it("skips files (non-directories) in plugins dir", async () => {
    const dir = await makeTempDir();
    cleanupDirs.push(dir);

    // A regular file sitting in the plugins dir
    await writeFile(join(dir, "README.md"), "not a plugin");

    // A valid plugin directory
    const plugin = join(dir, "real-plugin");
    await mkdir(plugin);
    await writeFile(join(plugin, "manifest.json"), MANIFEST_JSON);

    const result = await scanPluginDirs({ pluginsDir: dir });
    expect(result).toEqual([plugin]);
  });

  it("returns absolute paths to valid plugin directories", async () => {
    const dir = await makeTempDir();
    cleanupDirs.push(dir);

    const plugin = join(dir, "abs-plugin");
    await mkdir(plugin);
    await writeFile(join(plugin, "manifest.json"), MANIFEST_JSON);

    const result = await scanPluginDirs({ pluginsDir: dir });
    expect(result).toHaveLength(1);
    // Every returned path must be absolute
    for (const p of result) {
      expect(p).toMatch(/^\//); // starts with /
    }
  });

  it("handles config-specified plugin paths", async () => {
    const dir = await makeTempDir();
    cleanupDirs.push(dir);

    // Config path points to a directory with manifest.json outside pluginsDir
    const configPlugin = join(dir, "external", "my-custom-plugin");
    await mkdir(configPlugin, { recursive: true });
    await writeFile(join(configPlugin, "manifest.json"), MANIFEST_JSON);

    // Empty pluginsDir (nothing to scan)
    const emptyPluginsDir = join(dir, "plugins");
    await mkdir(emptyPluginsDir);

    const result = await scanPluginDirs({
      pluginsDir: emptyPluginsDir,
      configPaths: { "custom-svc": configPlugin },
    });

    expect(result).toContain(configPlugin);
  });
});
