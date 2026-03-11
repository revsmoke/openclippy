import { readdir, stat, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { constants } from "node:fs";

const DEFAULT_PLUGINS_DIR = join(homedir(), ".openclippy", "plugins");

/**
 * Check whether a file/directory exists without throwing.
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan for plugin directories containing manifest.json files.
 *
 * @param options.pluginsDir - Directory to scan (default: ~/.openclippy/plugins/)
 * @param options.configPaths - Explicit plugin paths from config (serviceId -> path)
 * @returns Absolute paths to valid plugin directories
 */
export async function scanPluginDirs(options?: {
  pluginsDir?: string;
  configPaths?: Record<string, string>;
}): Promise<string[]> {
  const pluginsDir = options?.pluginsDir ?? DEFAULT_PLUGINS_DIR;
  const configPaths = options?.configPaths ?? {};
  const found = new Set<string>();

  // 1. Collect explicit config paths first
  for (const rawPath of Object.values(configPaths)) {
    const abs = resolve(rawPath);
    const manifest = join(abs, "manifest.json");
    if (await exists(manifest)) {
      found.add(abs);
    }
  }

  // 2. Scan pluginsDir for directories containing manifest.json
  if (await exists(pluginsDir)) {
    let entries: string[];
    try {
      entries = await readdir(pluginsDir);
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      const entryPath = join(pluginsDir, entry);

      // Skip non-directories
      const entryStat = await stat(entryPath);
      if (!entryStat.isDirectory()) continue;

      // Check for manifest.json inside the directory
      const manifest = join(entryPath, "manifest.json");
      if (await exists(manifest)) {
        found.add(resolve(entryPath));
      }
    }
  }

  // 3. Return deduplicated absolute paths
  return [...found];
}
