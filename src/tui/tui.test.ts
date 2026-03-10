import { describe, it, expect } from "vitest";
import { parseSlashCommand, formatResponse, SLASH_COMMANDS } from "./tui.js";

describe("parseSlashCommand", () => {
  it("recognizes /help command", () => {
    expect(parseSlashCommand("/help")).toEqual({ command: "help", args: "" });
  });

  it("recognizes /reset command", () => {
    expect(parseSlashCommand("/reset")).toEqual({ command: "reset", args: "" });
  });

  it("recognizes /status command", () => {
    expect(parseSlashCommand("/status")).toEqual({ command: "status", args: "" });
  });

  it("recognizes /quit command", () => {
    expect(parseSlashCommand("/quit")).toEqual({ command: "quit", args: "" });
  });

  it("recognizes /exit command", () => {
    expect(parseSlashCommand("/exit")).toEqual({ command: "quit", args: "" });
  });

  it("recognizes /services command", () => {
    expect(parseSlashCommand("/services")).toEqual({ command: "services", args: "" });
  });

  it("recognizes /model command with args", () => {
    expect(parseSlashCommand("/model claude-sonnet-4-5-20250514")).toEqual({
      command: "model",
      args: "claude-sonnet-4-5-20250514",
    });
  });

  it("returns null for non-slash input", () => {
    expect(parseSlashCommand("hello there")).toBeNull();
  });

  it("returns unknown for unrecognized slash command", () => {
    expect(parseSlashCommand("/foobar")).toEqual({ command: "unknown", args: "/foobar" });
  });

  it("trims whitespace from args", () => {
    expect(parseSlashCommand("/model   claude-sonnet-4-5-20250514  ")).toEqual({
      command: "model",
      args: "claude-sonnet-4-5-20250514",
    });
  });
});

describe("formatResponse", () => {
  it("wraps response with emoji prefix", () => {
    const result = formatResponse("Hello!", { name: "Clippy", emoji: "📎" });
    expect(result).toContain("📎");
    expect(result).toContain("Hello!");
  });

  it("handles empty response", () => {
    const result = formatResponse("", { name: "Clippy", emoji: "📎" });
    expect(result).toContain("📎");
  });

  it("handles multi-line response", () => {
    const result = formatResponse("Line 1\nLine 2\nLine 3", { name: "Clippy", emoji: "📎" });
    expect(result).toContain("Line 1");
    expect(result).toContain("Line 3");
  });
});

describe("SLASH_COMMANDS", () => {
  it("exports command definitions with descriptions", () => {
    expect(SLASH_COMMANDS).toBeDefined();
    expect(SLASH_COMMANDS.length).toBeGreaterThan(0);
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.name).toBeTruthy();
      expect(cmd.description).toBeTruthy();
    }
  });
});
