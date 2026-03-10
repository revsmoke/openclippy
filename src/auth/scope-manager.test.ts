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
});
