import { describe, it, expect, vi } from "vitest";
import { ServiceRegistry } from "./registry.js";
import type { ServiceModule, AgentTool } from "./types.js";
import type { ServicesConfig } from "../config/types.services.js";

/** Helper: create a minimal mock ServiceModule */
function mockModule(
  id: ServiceModule["id"],
  overrides?: Partial<ServiceModule>,
): ServiceModule {
  const tools: AgentTool[] = [
    {
      name: `${id}_list`,
      description: `List ${id} items`,
      inputSchema: { type: "object", properties: {} },
      execute: vi.fn().mockResolvedValue({ content: "[]" }),
    },
  ];

  return {
    id,
    meta: {
      label: id.charAt(0).toUpperCase() + id.slice(1),
      description: `${id} service module`,
      requiredScopes: [`${id}.Read`],
      optionalScopes: [`${id}.ReadWrite`],
    },
    capabilities: {
      read: true,
      write: false,
      delete: false,
      search: false,
      subscribe: false,
    },
    tools: () => tools,
    ...overrides,
  };
}

describe("ServiceRegistry", () => {
  // ------------------------------------------------------------------
  // register + get
  // ------------------------------------------------------------------
  describe("register / get", () => {
    it("registers and retrieves a service module by id", () => {
      const registry = new ServiceRegistry();
      const mod = mockModule("mail");
      registry.register(mod);
      expect(registry.get("mail")).toBe(mod);
    });

    it("returns undefined for an unregistered service", () => {
      const registry = new ServiceRegistry();
      expect(registry.get("mail")).toBeUndefined();
    });

    it("overwrites a previously registered module with the same id", () => {
      const registry = new ServiceRegistry();
      const mod1 = mockModule("mail");
      const mod2 = mockModule("mail", {
        meta: {
          label: "Mail v2",
          description: "Updated mail module",
          requiredScopes: ["Mail.Read"],
        },
      });
      registry.register(mod1);
      registry.register(mod2);
      expect(registry.get("mail")).toBe(mod2);
    });
  });

  // ------------------------------------------------------------------
  // listRegistered
  // ------------------------------------------------------------------
  describe("listRegistered", () => {
    it("returns empty array when nothing is registered", () => {
      const registry = new ServiceRegistry();
      expect(registry.listRegistered()).toEqual([]);
    });

    it("returns ids of all registered modules", () => {
      const registry = new ServiceRegistry();
      registry.register(mockModule("mail"));
      registry.register(mockModule("calendar"));
      registry.register(mockModule("todo"));
      const ids = registry.listRegistered();
      expect(ids).toHaveLength(3);
      expect(ids).toContain("mail");
      expect(ids).toContain("calendar");
      expect(ids).toContain("todo");
    });
  });

  // ------------------------------------------------------------------
  // getEnabled
  // ------------------------------------------------------------------
  describe("getEnabled", () => {
    it("returns only modules whose service is enabled in config", () => {
      const registry = new ServiceRegistry();
      registry.register(mockModule("mail"));
      registry.register(mockModule("calendar"));
      registry.register(mockModule("todo"));

      const config: ServicesConfig = {
        mail: { enabled: true },
        calendar: { enabled: false },
        todo: { enabled: true },
      };

      const enabled = registry.getEnabled(config);
      expect(enabled).toHaveLength(2);
      expect(enabled.map((m) => m.id)).toContain("mail");
      expect(enabled.map((m) => m.id)).toContain("todo");
      expect(enabled.map((m) => m.id)).not.toContain("calendar");
    });

    it("excludes registered modules that have no config entry", () => {
      const registry = new ServiceRegistry();
      registry.register(mockModule("mail"));
      registry.register(mockModule("calendar"));

      const config: ServicesConfig = {
        mail: { enabled: true },
        // calendar not in config at all
      };

      const enabled = registry.getEnabled(config);
      expect(enabled).toHaveLength(1);
      expect(enabled[0].id).toBe("mail");
    });

    it("returns empty array when no modules are enabled", () => {
      const registry = new ServiceRegistry();
      registry.register(mockModule("mail"));

      const config: ServicesConfig = {
        mail: { enabled: false },
      };

      expect(registry.getEnabled(config)).toEqual([]);
    });

    it("returns empty array when config is empty", () => {
      const registry = new ServiceRegistry();
      registry.register(mockModule("mail"));
      expect(registry.getEnabled({})).toEqual([]);
    });
  });

  // ------------------------------------------------------------------
  // getAllTools
  // ------------------------------------------------------------------
  describe("getAllTools", () => {
    it("collects tools from all enabled services", () => {
      const registry = new ServiceRegistry();

      const mailTools: AgentTool[] = [
        {
          name: "mail_list",
          description: "List emails",
          inputSchema: { type: "object" },
          execute: vi.fn().mockResolvedValue({ content: "[]" }),
        },
        {
          name: "mail_read",
          description: "Read email",
          inputSchema: { type: "object" },
          execute: vi.fn().mockResolvedValue({ content: "{}" }),
        },
      ];

      const calTools: AgentTool[] = [
        {
          name: "calendar_list",
          description: "List events",
          inputSchema: { type: "object" },
          execute: vi.fn().mockResolvedValue({ content: "[]" }),
        },
      ];

      registry.register(mockModule("mail", { tools: () => mailTools }));
      registry.register(mockModule("calendar", { tools: () => calTools }));
      registry.register(mockModule("todo")); // disabled below

      const config: ServicesConfig = {
        mail: { enabled: true },
        calendar: { enabled: true },
        todo: { enabled: false },
      };

      const tools = registry.getAllTools(config);
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name)).toEqual([
        "mail_list",
        "mail_read",
        "calendar_list",
      ]);
    });

    it("returns empty array when no services are enabled", () => {
      const registry = new ServiceRegistry();
      registry.register(mockModule("mail"));
      expect(registry.getAllTools({})).toEqual([]);
    });
  });

  // ------------------------------------------------------------------
  // probeAll
  // ------------------------------------------------------------------
  describe("probeAll", () => {
    it("probes all enabled services that have a status.probe method", async () => {
      const registry = new ServiceRegistry();

      const mailProbe = vi.fn().mockResolvedValue({ ok: true });
      const calProbe = vi
        .fn()
        .mockResolvedValue({ ok: false, error: "no calendar access" });

      registry.register(
        mockModule("mail", {
          status: { probe: mailProbe },
        }),
      );
      registry.register(
        mockModule("calendar", {
          status: { probe: calProbe },
        }),
      );
      // todo has no status.probe
      registry.register(mockModule("todo"));

      const config: ServicesConfig = {
        mail: { enabled: true },
        calendar: { enabled: true },
        todo: { enabled: true },
      };

      const results = await registry.probeAll({
        token: "test-token",
        config,
      });

      expect(results.get("mail")).toEqual({ ok: true });
      expect(results.get("calendar")).toEqual({
        ok: false,
        error: "no calendar access",
      });
      // todo has no probe, so it should not appear in results
      expect(results.has("todo")).toBe(false);

      expect(mailProbe).toHaveBeenCalledWith({ token: "test-token" });
      expect(calProbe).toHaveBeenCalledWith({ token: "test-token" });
    });

    it("captures probe exceptions as error results", async () => {
      const registry = new ServiceRegistry();

      const brokenProbe = vi
        .fn()
        .mockRejectedValue(new Error("connection refused"));

      registry.register(
        mockModule("mail", {
          status: { probe: brokenProbe },
        }),
      );

      const config: ServicesConfig = {
        mail: { enabled: true },
      };

      const results = await registry.probeAll({
        token: "test-token",
        config,
      });

      expect(results.get("mail")).toEqual({
        ok: false,
        error: "connection refused",
      });
    });

    it("returns empty map when no services have probes", async () => {
      const registry = new ServiceRegistry();
      registry.register(mockModule("mail"));

      const config: ServicesConfig = {
        mail: { enabled: true },
      };

      const results = await registry.probeAll({
        token: "test-token",
        config,
      });

      expect(results.size).toBe(0);
    });

    it("skips disabled services even if they have probes", async () => {
      const registry = new ServiceRegistry();
      const probe = vi.fn().mockResolvedValue({ ok: true });

      registry.register(
        mockModule("mail", {
          status: { probe },
        }),
      );

      const config: ServicesConfig = {
        mail: { enabled: false },
      };

      const results = await registry.probeAll({
        token: "test-token",
        config,
      });

      expect(results.size).toBe(0);
      expect(probe).not.toHaveBeenCalled();
    });
  });
});
