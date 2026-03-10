import { describe, it, expect } from "vitest";
import { MSALClient } from "./msal-client.js";

describe("MSALClient", () => {
  it("can be instantiated with config", () => {
    const client = new MSALClient({
      clientId: "test-client-id",
      tenantId: "test-tenant-id",
    });
    expect(client).toBeDefined();
  });

  it("reports not authenticated when no cache exists", async () => {
    const client = new MSALClient({
      clientId: "test-client-id",
      tenantId: "test-tenant-id",
      cachePath: "/tmp/nonexistent-openclippy-cache.json",
    });
    const result = await client.isAuthenticated();
    expect(result).toBe(false);
  });
});
