import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { useTempDir } from "../test-utils/temp-dir.js";
import { loadDotEnv } from "./load-env.js";

describe("loadDotEnv", () => {
  const tmp = useTempDir("load-env");
  const touched: string[] = [];

  afterEach(() => {
    for (const key of touched) delete process.env[key];
    touched.length = 0;
  });

  it("loads variables from a .env file in the given directory", async () => {
    const dir = await tmp.create();
    await writeFile(join(dir, ".env"), "OPENCLIPPY_TEST_VAR=from_env_file\n");
    touched.push("OPENCLIPPY_TEST_VAR");

    loadDotEnv(dir);
    expect(process.env.OPENCLIPPY_TEST_VAR).toBe("from_env_file");
  });

  it("does not override an already-set environment variable", async () => {
    const dir = await tmp.create();
    await writeFile(join(dir, ".env"), "OPENCLIPPY_TEST_VAR=from_env_file\n");
    touched.push("OPENCLIPPY_TEST_VAR");
    process.env.OPENCLIPPY_TEST_VAR = "from_shell";

    loadDotEnv(dir);
    expect(process.env.OPENCLIPPY_TEST_VAR).toBe("from_shell");
  });

  it("is a no-op (no throw) when no .env file exists", async () => {
    const dir = await tmp.create();
    expect(() => loadDotEnv(dir)).not.toThrow();
  });
});
