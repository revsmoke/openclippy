import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock modules before imports ---

const mockRunSetupWizard = vi.fn().mockResolvedValue(undefined);

vi.mock("./wizard.js", () => ({
  runSetupWizard: mockRunSetupWizard,
}));

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../config/paths.js", () => ({
  CONFIG_PATH: "/mock/.openclippy/config.yaml",
  STATE_DIR: "/mock/.openclippy",
}));

// --- Now import the modules under test ---

import { configCommand } from "./config.js";
import { loadConfig } from "../config/config.js";

const mockLoadConfig = vi.mocked(loadConfig);

const DEFAULT_TEST_CONFIG = {
  azure: { clientId: "test-client-id", tenantId: "test-tenant-id" },
  services: { mail: { enabled: true } },
  agent: { model: "claude-sonnet-4-5-20250514", toolProfile: "standard" },
  tools: { profile: "standard" as const },
  gateway: { port: 4100, host: "localhost" },
};

describe("configCommand – wizard routing", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(DEFAULT_TEST_CONFIG);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("calls runSetupWizard when --setup is passed", async () => {
    await configCommand({ setup: true });

    expect(mockRunSetupWizard).toHaveBeenCalledOnce();
    // Should NOT fall through to loadConfig / show config
    expect(mockLoadConfig).not.toHaveBeenCalled();
  });

  it("does NOT call wizard when --show is passed", async () => {
    await configCommand({ show: true });

    expect(mockRunSetupWizard).not.toHaveBeenCalled();
    expect(mockLoadConfig).toHaveBeenCalledOnce();
  });

  it("does NOT call wizard when no options are passed", async () => {
    await configCommand();

    expect(mockRunSetupWizard).not.toHaveBeenCalled();
    expect(mockLoadConfig).toHaveBeenCalledOnce();
  });

  it("does NOT call wizard when setup is false", async () => {
    await configCommand({ setup: false });

    expect(mockRunSetupWizard).not.toHaveBeenCalled();
    expect(mockLoadConfig).toHaveBeenCalledOnce();
  });
});
