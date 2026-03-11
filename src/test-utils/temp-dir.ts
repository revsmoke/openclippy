import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach } from "vitest";

/**
 * Creates a temp directory manager that auto-cleans in afterEach.
 *
 * Call in `describe()` scope (or at module level), then use `create()`
 * inside individual tests to get an isolated temp directory.
 *
 * @example
 * ```ts
 * describe("myFeature", () => {
 *   const tmp = useTempDir("myFeature");
 *
 *   it("writes a file", async () => {
 *     const dir = await tmp.create();
 *     await writeFile(join(dir, "test.txt"), "hello");
 *   });
 *   // dir is automatically cleaned up after the test
 * });
 * ```
 */
export function useTempDir(prefix: string) {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs) {
      await rm(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  return {
    /** Create a new temp directory. Cleaned up automatically after each test. */
    async create(): Promise<string> {
      const dir = await mkdtemp(join(tmpdir(), `openclippy-${prefix}-`));
      dirs.push(dir);
      return dir;
    },
  };
}
