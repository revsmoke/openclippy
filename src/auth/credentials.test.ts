import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DEFAULT_CONFIG } from "../config/defaults.js";

describe("resolveAzureCredentials", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear any credential env vars before each test
    delete process.env.OPENCLIPPY_CLIENT_ID;
    delete process.env.OPENCLIPPY_TENANT_ID;
    delete process.env.AZURE_CLIENT_ID;
    delete process.env.AZURE_TENANT_ID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns config values when config is provided", async () => {
    const { resolveAzureCredentials } = await import("./credentials.js");
    const cfg = {
      azure: { clientId: "custom-client", tenantId: "custom-tenant" },
      services: {},
      agent: { model: "test", toolProfile: "standard" as const, identity: { name: "test", emoji: "T" } },
      tools: { profile: "standard" as const, allow: [], deny: [] },
      gateway: { port: 4100, host: "localhost" },
      plugins: {},
    };
    const creds = resolveAzureCredentials(cfg);
    expect(creds.clientId).toBe("custom-client");
    expect(creds.tenantId).toBe("custom-tenant");
  });

  it("falls back to env vars when no config", async () => {
    process.env.OPENCLIPPY_CLIENT_ID = "env-client";
    process.env.OPENCLIPPY_TENANT_ID = "env-tenant";
    const { resolveAzureCredentials } = await import("./credentials.js");
    const creds = resolveAzureCredentials();
    expect(creds.clientId).toBe("env-client");
    expect(creds.tenantId).toBe("env-tenant");
  });

  it("falls back to DEFAULT_CONFIG values when no config and no env vars", async () => {
    const { resolveAzureCredentials } = await import("./credentials.js");
    const creds = resolveAzureCredentials();
    expect(creds.clientId).toBe(DEFAULT_CONFIG.azure.clientId);
    expect(creds.tenantId).toBe(DEFAULT_CONFIG.azure.tenantId);
  });

  it("does not contain hardcoded credential strings in source", async () => {
    // This test verifies the refactoring goal: the credentials module
    // should reference DEFAULT_CONFIG rather than hardcoded strings.
    // We read the source file and verify no raw credential UUIDs appear.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.join(import.meta.dirname, "credentials.ts"),
      "utf-8",
    );
    expect(source).not.toContain("bfe7dd6e-ed60-4bf4-8396-801a8eada469");
    expect(source).not.toContain("ddd9f933-04a5-43f0-8673-5933da46cdcb");
  });
});
