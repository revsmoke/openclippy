import { describe, it, expect } from "vitest";
import { ScopeManager } from "./scope-manager.js";

describe("ScopeManager", () => {
  it("computes required scopes for enabled services", () => {
    const mgr = new ScopeManager();
    const scopes = mgr.computeRequiredScopes(["mail", "calendar"]);
    expect(scopes).toContain("User.Read");
    expect(scopes).toContain("offline_access");
    expect(scopes).toContain("Mail.Read");
    expect(scopes).toContain("Calendars.Read");
  });

  it("tracks granted scopes", () => {
    const mgr = new ScopeManager();
    mgr.recordGrantedScopes(["User.Read", "Mail.Read", "Mail.Send"]);
    expect(mgr.hasRequiredScopes("mail")).toBe(true);
    expect(mgr.getGrantedScopes()).toContain("Mail.Read");
  });

  it("detects missing scopes", () => {
    const mgr = new ScopeManager();
    mgr.recordGrantedScopes(["User.Read", "offline_access"]);
    const missing = mgr.getMissingScopes(["mail", "calendar"]);
    expect(missing).toContain("Mail.Read");
    expect(missing).toContain("Calendars.Read");
    expect(missing).not.toContain("User.Read");
  });

  it("includes base scopes always", () => {
    const mgr = new ScopeManager();
    const base = mgr.getBaseScopes();
    expect(base).toContain("User.Read");
    expect(base).toContain("offline_access");
  });

  // --- Plugin scope registration tests ---

  describe("plugin scope registration", () => {
    it("registerPluginScopes adds scopes to the scope map", () => {
      const mgr = new ScopeManager();
      mgr.registerPluginScopes("my-plugin", {
        required: ["CustomScope.Read"],
        optional: ["CustomScope.ReadWrite"],
      });
      // Verify by computing scopes with the plugin service enabled
      const scopes = mgr.computeRequiredScopes(["my-plugin"]);
      expect(scopes).toContain("CustomScope.Read");
      expect(scopes).toContain("CustomScope.ReadWrite");
    });

    it("computeRequiredScopes includes plugin scopes when plugin service is enabled", () => {
      const mgr = new ScopeManager();
      mgr.registerPluginScopes("crm-connector", {
        required: ["CRM.Read"],
        optional: ["CRM.Write"],
      });
      const scopes = mgr.computeRequiredScopes(["mail", "crm-connector"]);
      // Builtin mail scopes
      expect(scopes).toContain("Mail.Read");
      expect(scopes).toContain("Mail.ReadWrite");
      // Plugin scopes
      expect(scopes).toContain("CRM.Read");
      expect(scopes).toContain("CRM.Write");
      // Base scopes always present
      expect(scopes).toContain("User.Read");
      expect(scopes).toContain("offline_access");
    });

    it("duplicate scope registration replaces previous entry", () => {
      const mgr = new ScopeManager();
      mgr.registerPluginScopes("my-plugin", {
        required: ["Old.Read"],
        optional: [],
      });
      mgr.registerPluginScopes("my-plugin", {
        required: ["New.Read"],
        optional: ["New.Write"],
      });
      const scopes = mgr.computeRequiredScopes(["my-plugin"]);
      expect(scopes).toContain("New.Read");
      expect(scopes).toContain("New.Write");
      expect(scopes).not.toContain("Old.Read");
    });

    it("plugin scopes don't interfere with builtin scopes", () => {
      const mgr = new ScopeManager();
      mgr.registerPluginScopes("my-plugin", {
        required: ["Plugin.Read"],
        optional: [],
      });
      // Only enable mail — plugin service is NOT enabled
      const scopes = mgr.computeRequiredScopes(["mail"]);
      expect(scopes).toContain("Mail.Read");
      expect(scopes).not.toContain("Plugin.Read");

      // Builtin mail still works correctly alongside plugin registration
      const mailOnlyScopes = mgr.computeRequiredScopes(["mail"]);
      expect(mailOnlyScopes).toContain("Mail.Read");
      expect(mailOnlyScopes).toContain("Mail.ReadWrite");
      expect(mailOnlyScopes).toContain("Mail.Send");
    });
  });
});
