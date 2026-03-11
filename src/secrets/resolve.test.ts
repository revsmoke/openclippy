import { describe, it, expect } from "vitest";
import { resolveSecret } from "./resolve.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { useTempDir } from "../test-utils/temp-dir.js";

describe("resolveSecret", () => {
  const tmp = useTempDir("secret");

  it("returns undefined for undefined input", async () => {
    expect(await resolveSecret(undefined)).toBeUndefined();
  });

  it("returns plain string as-is", async () => {
    expect(await resolveSecret("my-secret")).toBe("my-secret");
  });

  it("resolves env source", async () => {
    process.env.TEST_OPENCLIPPY_SECRET = "env-value";
    const result = await resolveSecret({ source: "env", key: "TEST_OPENCLIPPY_SECRET" });
    expect(result).toBe("env-value");
    delete process.env.TEST_OPENCLIPPY_SECRET;
  });

  it("returns undefined for missing env var", async () => {
    const result = await resolveSecret({ source: "env", key: "NONEXISTENT_VAR_XYZ" });
    expect(result).toBeUndefined();
  });

  it("resolves file source", async () => {
    const dir = await tmp.create();
    const secretFile = join(dir, "secret.txt");
    await writeFile(secretFile, "file-secret\n", "utf-8");

    const result = await resolveSecret({ source: "file", path: secretFile });
    expect(result).toBe("file-secret");
  });

  it("resolves exec source", async () => {
    const result = await resolveSecret({ source: "exec", command: "echo exec-secret" });
    expect(result).toBe("exec-secret");
  });
});
