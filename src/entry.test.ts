import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock modules before imports ---

const mockRunSetupWizard = vi.fn().mockResolvedValue(undefined);
const mockParseAsync = vi.fn().mockResolvedValue(undefined);
const mockProgram = { parseAsync: mockParseAsync };

vi.mock("./cli/program.js", () => ({
  createProgram: vi.fn(() => mockProgram),
}));

vi.mock("./cli/wizard.js", () => ({
  runSetupWizard: mockRunSetupWizard,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
  };
});

vi.mock("./config/paths.js", () => ({
  CONFIG_PATH: "/mock/.openclippy/config.yaml",
  STATE_DIR: "/mock/.openclippy",
  TOKEN_CACHE_PATH: "/mock/.openclippy/token-cache.json",
  MEMORY_DB_PATH: "/mock/.openclippy/memory.db",
  LOG_DIR: "/mock/.openclippy/logs",
  LOG_PATH: "/mock/.openclippy/logs/openclippy.log",
}));

// --- Now import the module under test ---

import { main } from "./entry.js";
import { existsSync } from "node:fs";

const mockExistsSync = vi.mocked(existsSync);

describe("entry – main()", () => {
  let savedArgv: string[];
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    savedArgv = process.argv;
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = savedArgv;
    consoleSpy.mockRestore();
  });

  it("launches wizard when no args and no config file", async () => {
    // Simulate: `node openclippy` (no subcommand)
    process.argv = ["node", "openclippy"];
    mockExistsSync.mockReturnValue(false);

    await main();

    expect(consoleSpy).toHaveBeenCalledWith(
      "No configuration found. Starting setup wizard...\n",
    );
    expect(mockRunSetupWizard).toHaveBeenCalledOnce();
    expect(mockParseAsync).not.toHaveBeenCalled();
  });

  it("does NOT launch wizard when CLI args are provided", async () => {
    // Simulate: `node openclippy status`
    process.argv = ["node", "openclippy", "status"];
    mockExistsSync.mockReturnValue(false);

    await main();

    expect(mockRunSetupWizard).not.toHaveBeenCalled();
    expect(mockParseAsync).toHaveBeenCalledOnce();
  });

  it("does NOT launch wizard when config file exists", async () => {
    // Simulate: `node openclippy` (no subcommand, but config exists)
    process.argv = ["node", "openclippy"];
    mockExistsSync.mockReturnValue(true);

    await main();

    expect(mockRunSetupWizard).not.toHaveBeenCalled();
    expect(mockParseAsync).toHaveBeenCalledOnce();
  });

  it("does NOT launch wizard when both args and config exist", async () => {
    process.argv = ["node", "openclippy", "login"];
    mockExistsSync.mockReturnValue(true);

    await main();

    expect(mockRunSetupWizard).not.toHaveBeenCalled();
    expect(mockParseAsync).toHaveBeenCalledOnce();
  });

  it("passes process.argv to program.parseAsync", async () => {
    process.argv = ["node", "openclippy", "ask", "hello"];
    mockExistsSync.mockReturnValue(true);

    await main();

    expect(mockParseAsync).toHaveBeenCalledWith(["node", "openclippy", "ask", "hello"]);
  });
});
