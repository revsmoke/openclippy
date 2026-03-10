import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";

// --- Hoisted mock variables (available in vi.mock factories) ---
const { mockGatewayInstance, mockWriteFile, mockReadFile, mockUnlink, mockMkdir, mockExistsSync } = vi.hoisted(() => ({
  mockGatewayInstance: {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    port: 4100,
    isRunning: false,
    sessionCount: 0,
  },
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockReadFile: vi.fn(),
  mockUnlink: vi.fn().mockResolvedValue(undefined),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  mockExistsSync: vi.fn(),
}));

// --- Mock modules ---

vi.mock("../gateway/server.js", () => ({
  Gateway: vi.fn(() => mockGatewayInstance),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(),
  ensureStateDir: vi.fn(),
}));

vi.mock("../config/paths.js", () => ({
  STATE_DIR: "/mock/.openclippy",
  CONFIG_PATH: "/mock/.openclippy/config.yaml",
  TOKEN_CACHE_PATH: "/mock/.openclippy/token-cache.json",
}));

vi.mock("node:fs/promises", () => ({
  writeFile: mockWriteFile,
  readFile: mockReadFile,
  unlink: mockUnlink,
  mkdir: mockMkdir,
}));

vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
}));

// --- Import after mocks ---

import { loadConfig } from "../config/config.js";
import {
  gatewayStartCommand,
  gatewayStopCommand,
  gatewayStatusCommand,
  PID_FILE_PATH,
  writePidFile,
  readPidFile,
  removePidFile,
  isProcessAlive,
} from "./gateway.js";

const mockLoadConfig = vi.mocked(loadConfig);

const DEFAULT_TEST_CONFIG = {
  azure: { clientId: "test-client-id", tenantId: "test-tenant-id" },
  services: {
    mail: { enabled: true },
    calendar: { enabled: true },
    todo: { enabled: true },
    "teams-chat": { enabled: true },
    onedrive: { enabled: false },
    planner: { enabled: false },
    onenote: { enabled: false },
    sharepoint: { enabled: false },
    people: { enabled: true },
    presence: { enabled: true },
  },
  agent: {
    model: "claude-sonnet-4-5-20250514",
    toolProfile: "standard",
    identity: { name: "Clippy", emoji: "\uD83D\uDCCE" },
  },
  tools: { profile: "standard" as const },
  gateway: { port: 4100, host: "localhost" },
};

// Helper to capture console output
function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };

  return {
    logs,
    errors,
    restore() {
      console.log = origLog;
      console.error = origError;
    },
  };
}

describe("Gateway CLI Commands", () => {
  let capture: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(DEFAULT_TEST_CONFIG);
    mockGatewayInstance.start.mockResolvedValue(undefined);
    mockGatewayInstance.stop.mockResolvedValue(undefined);
    mockGatewayInstance.port = 4100;
    mockGatewayInstance.isRunning = false;
    mockGatewayInstance.sessionCount = 0;
    process.exitCode = undefined;
    capture = captureConsole();
  });

  afterEach(() => {
    capture.restore();
    process.exitCode = undefined;
  });

  // ==================== PID file path ====================

  describe("PID_FILE_PATH", () => {
    it("is located in the state directory", () => {
      expect(PID_FILE_PATH).toBe(join("/mock/.openclippy", "gateway.pid"));
    });
  });

  // ==================== PID file helpers ====================

  describe("writePidFile", () => {
    it("writes the process PID to the PID file", async () => {
      await writePidFile(12345);

      expect(mockMkdir).toHaveBeenCalledWith("/mock/.openclippy", {
        recursive: true,
      });
      expect(mockWriteFile).toHaveBeenCalledWith(
        PID_FILE_PATH,
        "12345",
        "utf-8",
      );
    });
  });

  describe("readPidFile", () => {
    it("returns the PID when file exists", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue("12345");

      const pid = await readPidFile();
      expect(pid).toBe(12345);
    });

    it("returns null when PID file does not exist", async () => {
      mockExistsSync.mockReturnValue(false);

      const pid = await readPidFile();
      expect(pid).toBeNull();
    });

    it("returns null when PID file contains invalid content", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue("not-a-number");

      const pid = await readPidFile();
      expect(pid).toBeNull();
    });
  });

  describe("removePidFile", () => {
    it("removes the PID file when it exists", async () => {
      mockExistsSync.mockReturnValue(true);

      await removePidFile();

      expect(mockUnlink).toHaveBeenCalledWith(PID_FILE_PATH);
    });

    it("does nothing when PID file does not exist", async () => {
      mockExistsSync.mockReturnValue(false);

      await removePidFile();

      expect(mockUnlink).not.toHaveBeenCalled();
    });
  });

  describe("isProcessAlive", () => {
    it("returns true for an alive process", () => {
      // process.pid is always alive (it's us)
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    it("returns false for a non-existent PID", () => {
      // PID 999999999 is extremely unlikely to exist
      expect(isProcessAlive(999999999)).toBe(false);
    });
  });

  // ==================== gatewayStartCommand ====================

  describe("gatewayStartCommand", () => {
    it("starts the gateway and logs the listening address", async () => {
      mockExistsSync.mockReturnValue(false); // no existing PID file

      await gatewayStartCommand();

      expect(mockGatewayInstance.start).toHaveBeenCalled();
      expect(
        capture.logs.some((l) =>
          l.includes("Gateway listening on http://localhost:4100"),
        ),
      ).toBe(true);
    });

    it("writes a PID file after starting", async () => {
      mockExistsSync.mockReturnValue(false);

      await gatewayStartCommand();

      expect(mockWriteFile).toHaveBeenCalledWith(
        PID_FILE_PATH,
        String(process.pid),
        "utf-8",
      );
    });

    it("uses port and host from config", async () => {
      mockExistsSync.mockReturnValue(false);
      mockLoadConfig.mockResolvedValue({
        ...DEFAULT_TEST_CONFIG,
        gateway: { port: 8080, host: "0.0.0.0" },
      });
      mockGatewayInstance.port = 8080;

      await gatewayStartCommand();

      expect(
        capture.logs.some((l) =>
          l.includes("Gateway listening on http://0.0.0.0:8080"),
        ),
      ).toBe(true);
    });

    it("refuses to start if gateway is already running (PID file exists and process alive)", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(String(process.pid));

      await gatewayStartCommand();

      expect(mockGatewayInstance.start).not.toHaveBeenCalled();
      expect(
        capture.errors.some((l) => l.includes("already running")),
      ).toBe(true);
    });

    it("cleans up stale PID file and starts if process is dead", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue("999999999");

      await gatewayStartCommand();

      expect(mockUnlink).toHaveBeenCalled();
      expect(mockGatewayInstance.start).toHaveBeenCalled();
    });

    it("prints error when gateway start fails", async () => {
      mockExistsSync.mockReturnValue(false);
      mockGatewayInstance.start.mockRejectedValue(new Error("Port in use"));

      await gatewayStartCommand();

      expect(
        capture.errors.some((l) => l.includes("Port in use")),
      ).toBe(true);
      expect(process.exitCode).toBe(1);
    });
  });

  // ==================== gatewayStopCommand ====================

  describe("gatewayStopCommand", () => {
    it("sends SIGTERM to the running gateway process", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(String(process.pid));

      // Mock process.kill to avoid actually killing ourselves
      const killSpy = vi
        .spyOn(process, "kill")
        .mockImplementation((() => true) as never);

      await gatewayStopCommand();

      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");
      killSpy.mockRestore();
    });

    it("removes the PID file after sending SIGTERM", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(String(process.pid));

      const killSpy = vi
        .spyOn(process, "kill")
        .mockImplementation((() => true) as never);

      await gatewayStopCommand();

      expect(mockUnlink).toHaveBeenCalledWith(PID_FILE_PATH);
      killSpy.mockRestore();
    });

    it("logs confirmation after stopping", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(String(process.pid));

      const killSpy = vi
        .spyOn(process, "kill")
        .mockImplementation((() => true) as never);

      await gatewayStopCommand();

      expect(
        capture.logs.some((l) => l.includes("Gateway stopped")),
      ).toBe(true);
      killSpy.mockRestore();
    });

    it("reports when no gateway is running (no PID file)", async () => {
      mockExistsSync.mockReturnValue(false);

      await gatewayStopCommand();

      expect(
        capture.logs.some((l) => l.includes("Gateway is not running")),
      ).toBe(true);
    });

    it("cleans up stale PID file when process is dead", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue("999999999");

      await gatewayStopCommand();

      expect(mockUnlink).toHaveBeenCalled();
      expect(
        capture.logs.some((l) => l.includes("not running")),
      ).toBe(true);
    });
  });

  // ==================== gatewayStatusCommand ====================

  describe("gatewayStatusCommand", () => {
    it("shows 'not running' when no PID file exists", async () => {
      mockExistsSync.mockReturnValue(false);

      await gatewayStatusCommand();

      expect(
        capture.logs.some((l) => l.includes("Gateway is not running")),
      ).toBe(true);
    });

    it("shows 'not running' and cleans up stale PID", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue("999999999");

      await gatewayStatusCommand();

      expect(
        capture.logs.some((l) => l.includes("not running")),
      ).toBe(true);
      expect(mockUnlink).toHaveBeenCalled();
    });

    it("shows running status with PID when process is alive", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(String(process.pid));

      await gatewayStatusCommand();

      expect(
        capture.logs.some((l) => l.includes("Gateway is running")),
      ).toBe(true);
      expect(
        capture.logs.some((l) => l.includes(String(process.pid))),
      ).toBe(true);
    });

    it("shows port from config", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(String(process.pid));

      await gatewayStatusCommand();

      expect(
        capture.logs.some((l) => l.includes("4100")),
      ).toBe(true);
    });
  });

  // ==================== Program registration ====================

  describe("program registration", () => {
    it("gateway command is registered in the CLI program", async () => {
      const { createProgram } = await import("./program.js");
      const program = createProgram();

      const gatewayCmd = program.commands.find((c) => c.name() === "gateway");
      expect(gatewayCmd).toBeDefined();
    });

    it("gateway has start, stop, and status subcommands", async () => {
      const { createProgram } = await import("./program.js");
      const program = createProgram();

      const gatewayCmd = program.commands.find((c) => c.name() === "gateway");
      expect(gatewayCmd).toBeDefined();

      const subcommands = gatewayCmd!.commands.map((c) => c.name());
      expect(subcommands).toContain("start");
      expect(subcommands).toContain("stop");
      expect(subcommands).toContain("status");
    });
  });
});
