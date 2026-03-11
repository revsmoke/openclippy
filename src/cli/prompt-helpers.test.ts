import { describe, it, expect } from "vitest";
import { Readable, Writable } from "node:stream";
import * as readline from "node:readline";
import { prompt, select, multiSelect, confirm } from "./prompt-helpers.js";

/**
 * Creates a mock readline.Interface that feeds answers on demand.
 * Lines are pushed one at a time each time the readable stream is read,
 * preventing the stream from closing before all answers are consumed.
 * This is essential for select() which calls rl.question() multiple
 * times when re-prompting on invalid input.
 */
function createMockRl(...answers: string[]): readline.Interface {
  const queue = [...answers];
  const input = new Readable({
    read() {
      setImmediate(() => {
        if (queue.length > 0) {
          this.push(queue.shift()! + "\n");
        } else {
          this.push(null);
        }
      });
    },
  });
  return readline.createInterface({
    input,
    output: new Writable({ write(_, __, cb) { cb(); } }),
  });
}

// ==================== prompt ====================

describe("prompt", () => {
  it("returns user input text", async () => {
    const rl = createMockRl("hello world");
    const result = await prompt(rl, "Enter something:");
    expect(result).toBe("hello world");
  });

  it("returns default value when user presses Enter (empty input)", async () => {
    const rl = createMockRl("");
    const result = await prompt(rl, "Enter something:", "fallback");
    expect(result).toBe("fallback");
  });

  it("trims whitespace from input", async () => {
    const rl = createMockRl("  spaced out  ");
    const result = await prompt(rl, "Enter something:");
    expect(result).toBe("spaced out");
  });
});

// ==================== select ====================

describe("select", () => {
  const options = [
    { label: "Apple", value: "apple" },
    { label: "Banana", value: "banana" },
    { label: "Cherry", value: "cherry" },
  ];

  it("returns the selected option's value", async () => {
    const rl = createMockRl("2");
    const result = await select(rl, "Pick a fruit:", options);
    expect(result).toBe("banana");
  });

  it("re-prompts on invalid input then accepts valid input", async () => {
    // First answer "abc" is invalid, second answer "5" is out of range, third "1" is valid
    const rl = createMockRl("abc", "5", "1");
    const result = await select(rl, "Pick a fruit:", options);
    expect(result).toBe("apple");
  });

  it("handles option at first index", async () => {
    const rl = createMockRl("1");
    const result = await select(rl, "Pick a fruit:", options);
    expect(result).toBe("apple");
  });

  it("handles option at last index", async () => {
    const rl = createMockRl("3");
    const result = await select(rl, "Pick a fruit:", options);
    expect(result).toBe("cherry");
  });
});

// ==================== multiSelect ====================

describe("multiSelect", () => {
  const options = [
    { label: "Read", value: "read", selected: true },
    { label: "Write", value: "write" },
    { label: "Execute", value: "execute", selected: true },
  ];

  it("returns array of selected option values from comma-separated input", async () => {
    const rl = createMockRl("1,3");
    const result = await multiSelect(rl, "Choose permissions:", options);
    expect(result).toEqual(["read", "execute"]);
  });

  it("supports 'all' keyword to select everything", async () => {
    const rl = createMockRl("all");
    const result = await multiSelect(rl, "Choose permissions:", options);
    expect(result).toEqual(["read", "write", "execute"]);
  });

  it("returns pre-selected options when user presses Enter (empty input)", async () => {
    const rl = createMockRl("");
    const result = await multiSelect(rl, "Choose permissions:", options);
    expect(result).toEqual(["read", "execute"]);
  });
});

// ==================== confirm ====================

describe("confirm", () => {
  it("returns true for 'y'", async () => {
    const rl = createMockRl("y");
    const result = await confirm(rl, "Continue?");
    expect(result).toBe(true);
  });

  it("returns true for 'Y'", async () => {
    const rl = createMockRl("Y");
    const result = await confirm(rl, "Continue?");
    expect(result).toBe(true);
  });

  it("returns false for 'n'", async () => {
    const rl = createMockRl("n");
    const result = await confirm(rl, "Continue?");
    expect(result).toBe(false);
  });

  it("returns false for 'N'", async () => {
    const rl = createMockRl("N");
    const result = await confirm(rl, "Continue?");
    expect(result).toBe(false);
  });

  it("returns default (true) when user presses Enter with defaultYes=true", async () => {
    const rl = createMockRl("");
    const result = await confirm(rl, "Continue?", true);
    expect(result).toBe(true);
  });
});
