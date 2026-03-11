import { describe, it, expect } from "vitest";
import { loadConfig, saveConfig } from "./config.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { useTempDir } from "../test-utils/temp-dir.js";

describe("loadConfig", () => {
  const tmp = useTempDir("config");

  it("returns defaults when config file does not exist", async () => {
    const dir = await tmp.create();
    const cfg = await loadConfig(join(dir, "nonexistent.yaml"));
    expect(cfg.azure?.clientId).toBe(DEFAULT_CONFIG.azure?.clientId);
    expect(cfg.services?.mail?.enabled).toBe(true);
  });

  it("merges user config with defaults", async () => {
    const dir = await tmp.create();
    const configPath = join(dir, "config.yaml");
    await writeFile(configPath, "agent:\n  model: gpt-4o\n", "utf-8");
    const cfg = await loadConfig(configPath);
    expect(cfg.agent?.model).toBe("gpt-4o");
    // Defaults preserved
    expect(cfg.azure?.clientId).toBe(DEFAULT_CONFIG.azure?.clientId);
    expect(cfg.services?.mail?.enabled).toBe(true);
  });

  it("handles empty config file", async () => {
    const dir = await tmp.create();
    const configPath = join(dir, "config.yaml");
    await writeFile(configPath, "", "utf-8");
    const cfg = await loadConfig(configPath);
    expect(cfg.azure?.clientId).toBe(DEFAULT_CONFIG.azure?.clientId);
  });
});

describe("saveConfig", () => {
  const tmp = useTempDir("config-save");

  it("writes config as YAML", async () => {
    const dir = await tmp.create();
    const configPath = join(dir, "config.yaml");
    await saveConfig(DEFAULT_CONFIG, configPath);
    const loaded = await loadConfig(configPath);
    expect(loaded.azure?.clientId).toBe(DEFAULT_CONFIG.azure?.clientId);
  });
});
