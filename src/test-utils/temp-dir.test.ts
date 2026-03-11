import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { useTempDir } from "./temp-dir.js";

describe("useTempDir", () => {
  const tmp = useTempDir("test");

  it("create() returns a directory path that exists", async () => {
    const dir = await tmp.create();
    expect(typeof dir).toBe("string");
    expect(existsSync(dir)).toBe(true);
  });

  it("create() returns unique directories on multiple calls", async () => {
    const dir1 = await tmp.create();
    const dir2 = await tmp.create();
    expect(dir1).not.toBe(dir2);
    expect(existsSync(dir1)).toBe(true);
    expect(existsSync(dir2)).toBe(true);
  });

  it("created directory is writable", async () => {
    const dir = await tmp.create();
    const filePath = join(dir, "test.txt");
    await writeFile(filePath, "hello", "utf-8");
    expect(existsSync(filePath)).toBe(true);
  });

  it("directory path contains the prefix", async () => {
    const dir = await tmp.create();
    expect(dir).toContain("openclippy-test-");
  });
});

describe("useTempDir cleanup", () => {
  const tmp = useTempDir("cleanup");
  let previousDir: string | undefined;

  it("first test: creates a directory (saved for next test to verify cleanup)", async () => {
    previousDir = await tmp.create();
    expect(existsSync(previousDir)).toBe(true);
  });

  it("second test: previous directory was cleaned up", () => {
    // The afterEach from the first test should have removed previousDir
    // NOTE: vitest runs tests sequentially within a describe block
    if (previousDir) {
      expect(existsSync(previousDir)).toBe(false);
    }
  });
});
