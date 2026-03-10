import { describe, it, expect, vi } from "vitest";

vi.mock("../tui/tui.js", () => ({
  startTui: vi.fn().mockResolvedValue(undefined),
}));

describe("chatCommand", () => {
  it("calls startTui", async () => {
    const { chatCommand } = await import("./chat.js");
    const { startTui } = await import("../tui/tui.js");
    await chatCommand();
    expect(startTui).toHaveBeenCalled();
  });
});
