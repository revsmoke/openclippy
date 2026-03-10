import type { ICachePlugin, TokenCacheContext } from "@azure/msal-node";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_CACHE_PATH = join(homedir(), ".openclippy", "token-cache.json");

export class TokenCachePlugin implements ICachePlugin {
  private cachePath: string;

  constructor(cachePath?: string) {
    this.cachePath = cachePath ?? DEFAULT_CACHE_PATH;
  }

  async beforeCacheAccess(context: TokenCacheContext): Promise<void> {
    try {
      const data = await readFile(this.cachePath, "utf-8");
      context.tokenCache.deserialize(data);
    } catch {
      // No cache file yet — start fresh
    }
  }

  async afterCacheAccess(context: TokenCacheContext): Promise<void> {
    if (context.cacheHasChanged) {
      await mkdir(dirname(this.cachePath), { recursive: true });
      await writeFile(this.cachePath, context.tokenCache.serialize(), { mode: 0o600 });
    }
  }
}
