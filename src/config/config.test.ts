import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, saveConfig } from "./config.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("loadConfig", () => {
  const tmpDir = join(tmpdir(), "openclippy-test-config");
  const tmpConfigPath = join(tmpDir, "config.yaml");

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when config file does not exist", async () => {
    const cfg = await loadConfig(join(tmpDir, "nonexistent.yaml"));
    expect(cfg.azure?.clientId).toBe(DEFAULT_CONFIG.azure?.clientId);
    expect(cfg.services?.mail?.enabled).toBe(true);
  });

  it("merges user config with defaults", async () => {
    await writeFile(tmpConfigPath, "agent:\n  model: gpt-4o\n", "utf-8");
    const cfg = await loadConfig(tmpConfigPath);
    expect(cfg.agent?.model).toBe("gpt-4o");
    // Defaults preserved
    expect(cfg.azure?.clientId).toBe(DEFAULT_CONFIG.azure?.clientId);
    expect(cfg.services?.mail?.enabled).toBe(true);
  });

  it("handles empty config file", async () => {
    await writeFile(tmpConfigPath, "", "utf-8");
    const cfg = await loadConfig(tmpConfigPath);
    expect(cfg.azure?.clientId).toBe(DEFAULT_CONFIG.azure?.clientId);
  });
});

describe("saveConfig", () => {
  const tmpDir = join(tmpdir(), "openclippy-test-save");
  const tmpConfigPath = join(tmpDir, "config.yaml");

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes config as YAML", async () => {
    await saveConfig(DEFAULT_CONFIG, tmpConfigPath);
    const loaded = await loadConfig(tmpConfigPath);
    expect(loaded.azure?.clientId).toBe(DEFAULT_CONFIG.azure?.clientId);
  });
});
