import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock modules before imports ---

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  ensureStateDir: vi.fn(),
}));

vi.mock("../config/paths.js", () => ({
  STATE_DIR: "/mock/.openclippy",
  CONFIG_PATH: "/mock/.openclippy/config.yaml",
  TOKEN_CACHE_PATH: "/mock/.openclippy/token-cache.json",
}));

vi.mock("../auth/credentials.js", () => ({
  resolveAzureCredentials: vi.fn(() => ({
    clientId: "test-client-id",
    tenantId: "test-tenant-id",
  })),
}));

vi.mock("../auth/msal-client.js", () => {
  const MSALClient = vi.fn();
  MSALClient.prototype.acquireToken = vi.fn();
  MSALClient.prototype.getAccount = vi.fn();
  MSALClient.prototype.isAuthenticated = vi.fn();
  MSALClient.prototype.logout = vi.fn();
  return { MSALClient };
});

vi.mock("../auth/scope-manager.js", () => {
  const ScopeManager = vi.fn();
  ScopeManager.prototype.computeRequiredScopes = vi.fn(() => [
    "User.Read",
    "offline_access",
    "Mail.Read",
  ]);
  ScopeManager.prototype.recordGrantedScopes = vi.fn();
  ScopeManager.prototype.hasRequiredScopes = vi.fn(() => true);
  ScopeManager.prototype.getBaseScopes = vi.fn(() => [
    "User.Read",
    "offline_access",
  ]);
  ScopeManager.prototype.getMissingScopes = vi.fn(() => []);
  ScopeManager.prototype.getGrantedScopes = vi.fn(() => []);
  return { ScopeManager };
});

// Mock agent modules for ask command
vi.mock("../agents/model-config.js", () => ({
  resolveModelConfig: vi.fn(() => ({
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250514",
    apiKey: "test-api-key",
    maxTokens: 4096,
  })),
}));

vi.mock("../agents/tool-registry.js", () => ({
  collectTools: vi.fn(() => []),
}));

vi.mock("../agents/prompt-builder.js", () => ({
  buildSystemPrompt: vi.fn(() => "You are Clippy."),
}));

vi.mock("../agents/session.js", () => {
  const AgentSession = vi.fn();
  AgentSession.prototype.addUserMessage = vi.fn();
  AgentSession.prototype.addAssistantMessage = vi.fn();
  AgentSession.prototype.getHistory = vi.fn(() => []);
  AgentSession.prototype.messages = [];
  return { AgentSession };
});

vi.mock("../agents/runtime.js", () => ({
  runAgent: vi.fn(() => Promise.resolve("Hello! I am Clippy.")),
}));

vi.mock("../services/registry.js", () => {
  const ServiceRegistry = vi.fn();
  ServiceRegistry.prototype.register = vi.fn();
  ServiceRegistry.prototype.getEnabled = vi.fn(() => []);
  ServiceRegistry.prototype.getAllTools = vi.fn(() => []);
  ServiceRegistry.prototype.listRegistered = vi.fn(() => []);
  return { ServiceRegistry };
});

vi.mock("../services/mail/module.js", () => ({
  mailModule: { id: "mail", meta: { label: "Mail" }, tools: () => [] },
}));
vi.mock("../services/calendar/module.js", () => ({
  calendarModule: { id: "calendar", meta: { label: "Calendar" }, tools: () => [] },
}));
vi.mock("../services/todo/module.js", () => ({
  todoModule: { id: "todo", meta: { label: "To Do" }, tools: () => [] },
}));
vi.mock("../services/teams-chat/module.js", () => ({
  teamsChatModule: { id: "teams-chat", meta: { label: "Teams Chat" }, tools: () => [] },
}));

// --- Now import the modules under test ---

import { loginCommand } from "./login.js";
import { statusCommand } from "./status.js";
import { servicesCommand } from "./services.js";
import { configCommand } from "./config.js";
import { askCommand } from "./ask.js";
import { loadConfig } from "../config/config.js";
import { MSALClient } from "../auth/msal-client.js";
import { runAgent } from "../agents/runtime.js";

const mockLoadConfig = vi.mocked(loadConfig);

function mockMSALClientInstance() {
  // Get the prototype methods which are the mocked ones
  return {
    acquireToken: vi.mocked(MSALClient.prototype.acquireToken),
    getAccount: vi.mocked(MSALClient.prototype.getAccount),
    isAuthenticated: vi.mocked(MSALClient.prototype.isAuthenticated),
    logout: vi.mocked(MSALClient.prototype.logout),
  };
}

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

describe("CLI Commands", () => {
  let capture: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(DEFAULT_TEST_CONFIG);
    process.exitCode = undefined;
    capture = captureConsole();
  });

  afterEach(() => {
    capture.restore();
    process.exitCode = undefined;
  });

  // ==================== loginCommand ====================

  describe("loginCommand", () => {
    it("authenticates and prints success with account name", async () => {
      const msal = mockMSALClientInstance();
      msal.acquireToken.mockResolvedValue({
        account: {
          username: "user@example.com",
          homeAccountId: "home-id",
          environment: "login.microsoftonline.com",
          tenantId: "test-tenant-id",
          localAccountId: "local-id",
        },
        scopes: ["User.Read", "Mail.Read"],
        accessToken: "test-token",
        idToken: "",
        idTokenClaims: {},
        authority: "https://login.microsoftonline.com/test-tenant-id",
        uniqueId: "unique-id",
        tenantId: "test-tenant-id",
        expiresOn: new Date(Date.now() + 3600000),
        tokenType: "Bearer",
        correlationId: "corr-id",
        fromCache: false,
      } as never);

      await loginCommand();

      expect(capture.logs.some((l) => l.includes("Authenticating"))).toBe(true);
      expect(capture.logs.some((l) => l.includes("Signed in as user@example.com"))).toBe(true);
      expect(capture.logs.some((l) => l.includes("Service status"))).toBe(true);
    });

    it("prints error when acquireToken fails", async () => {
      const msal = mockMSALClientInstance();
      msal.acquireToken.mockRejectedValue(new Error("Auth failed"));

      await loginCommand();

      expect(capture.errors.some((l) => l.includes("Login failed"))).toBe(true);
      expect(process.exitCode).toBe(1);
    });
  });

  // ==================== statusCommand ====================

  describe("statusCommand", () => {
    it("shows authenticated status when logged in", async () => {
      const msal = mockMSALClientInstance();
      msal.isAuthenticated.mockResolvedValue(true);
      msal.getAccount.mockResolvedValue({
        username: "user@example.com",
        tenantId: "test-tenant-id",
        homeAccountId: "home-id",
        environment: "login.microsoftonline.com",
        localAccountId: "local-id",
      } as never);

      await statusCommand();

      expect(capture.logs.some((l) => l.includes("OpenClippy Status"))).toBe(true);
      expect(capture.logs.some((l) => l.includes("Authenticated"))).toBe(true);
      expect(capture.logs.some((l) => l.includes("user@example.com"))).toBe(true);
      expect(capture.logs.some((l) => l.includes("Services:"))).toBe(true);
    });

    it("suggests login when not authenticated", async () => {
      const msal = mockMSALClientInstance();
      msal.isAuthenticated.mockResolvedValue(false);

      await statusCommand();

      expect(capture.logs.some((l) => l.includes("Not authenticated"))).toBe(true);
      expect(capture.logs.some((l) => l.includes("openclippy login"))).toBe(true);
    });

    it("shows agent model and tool profile", async () => {
      const msal = mockMSALClientInstance();
      msal.isAuthenticated.mockResolvedValue(false);

      await statusCommand();

      expect(capture.logs.some((l) => l.includes("claude-sonnet-4-5-20250514"))).toBe(true);
      expect(capture.logs.some((l) => l.includes("standard"))).toBe(true);
    });
  });

  // ==================== servicesCommand ====================

  describe("servicesCommand", () => {
    it("lists all services with enabled/disabled status", async () => {
      await servicesCommand();

      expect(capture.logs.some((l) => l.includes("Microsoft 365 Services"))).toBe(true);
      // Enabled services
      expect(capture.logs.some((l) => l.includes("mail") && l.includes("enabled"))).toBe(true);
      expect(capture.logs.some((l) => l.includes("calendar") && l.includes("enabled"))).toBe(true);
      expect(capture.logs.some((l) => l.includes("todo") && l.includes("enabled"))).toBe(true);
      // Disabled services
      expect(capture.logs.some((l) => l.includes("onedrive") && l.includes("disabled"))).toBe(true);
      expect(capture.logs.some((l) => l.includes("planner") && l.includes("disabled"))).toBe(true);
    });

    it("shows scope information for enabled services", async () => {
      await servicesCommand();

      // Should show scopes for enabled services
      expect(capture.logs.some((l) => l.includes("Scopes:"))).toBe(true);
    });

    it("shows summary count", async () => {
      await servicesCommand();

      // 6 enabled (mail, calendar, todo, teams-chat, people, presence)
      expect(capture.logs.some((l) => l.includes("6 of 10 services enabled"))).toBe(true);
    });
  });

  // ==================== configCommand ====================

  describe("configCommand", () => {
    it("displays configuration with --show", async () => {
      await configCommand({ show: true });

      expect(capture.logs.some((l) => l.includes("OpenClippy Configuration"))).toBe(true);
      expect(capture.logs.some((l) => l.includes("Config file:"))).toBe(true);
    });

    it("displays config by default (no options)", async () => {
      await configCommand();

      expect(capture.logs.some((l) => l.includes("OpenClippy Configuration"))).toBe(true);
    });

    it("redacts API keys in output", async () => {
      mockLoadConfig.mockResolvedValue({
        ...DEFAULT_TEST_CONFIG,
        agent: {
          ...DEFAULT_TEST_CONFIG.agent,
          apiKey: "sk-ant-1234567890abcdef",
        },
      });

      await configCommand({ show: true });

      // Find the JSON output line
      const jsonOutput = capture.logs.find((l) => l.includes("apiKey"));
      expect(jsonOutput).toBeDefined();
      // Should be redacted
      expect(jsonOutput).toContain("sk-a****");
      expect(jsonOutput).not.toContain("sk-ant-1234567890abcdef");
    });

    it("shows config file path", async () => {
      await configCommand();

      expect(capture.logs.some((l) => l.includes("/mock/.openclippy/config.yaml"))).toBe(true);
    });
  });

  // ==================== askCommand ====================

  describe("askCommand", () => {
    it("prints error when not authenticated", async () => {
      const msal = mockMSALClientInstance();
      msal.isAuthenticated.mockResolvedValue(false);

      await askCommand("What emails do I have?");

      expect(capture.errors.some((l) => l.includes("Not authenticated"))).toBe(true);
      expect(capture.errors.some((l) => l.includes("openclippy login"))).toBe(true);
      expect(process.exitCode).toBe(1);
    });

    it("runs agent and prints response when authenticated", async () => {
      const msal = mockMSALClientInstance();
      msal.isAuthenticated.mockResolvedValue(true);
      msal.acquireToken.mockResolvedValue({
        account: {
          username: "user@example.com",
          name: "Test User",
          homeAccountId: "home-id",
          environment: "login.microsoftonline.com",
          tenantId: "test-tenant-id",
          localAccountId: "local-id",
        },
        scopes: ["User.Read", "Mail.Read"],
        accessToken: "test-access-token",
        idToken: "",
        idTokenClaims: {},
        authority: "https://login.microsoftonline.com/test-tenant-id",
        uniqueId: "unique-id",
        tenantId: "test-tenant-id",
        expiresOn: new Date(Date.now() + 3600000),
        tokenType: "Bearer",
        correlationId: "corr-id",
        fromCache: true,
      } as never);

      vi.mocked(runAgent).mockResolvedValue("You have 5 unread emails.");

      await askCommand("What emails do I have?");

      expect(capture.logs.some((l) => l.includes("You have 5 unread emails."))).toBe(true);
      expect(process.exitCode).not.toBe(1);
    });

    it("handles agent runtime errors gracefully", async () => {
      const msal = mockMSALClientInstance();
      msal.isAuthenticated.mockResolvedValue(true);
      msal.acquireToken.mockRejectedValue(new Error("Token expired"));

      await askCommand("What emails do I have?");

      expect(capture.errors.some((l) => l.includes("Token expired"))).toBe(true);
      expect(process.exitCode).toBe(1);
    });
  });
});
