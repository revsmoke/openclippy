import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { CONFIG_PATH, STATE_DIR } from "./paths.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { OpenClippyConfig } from "./types.base.js";

/** Deep merge two objects (source overrides target) */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (
      sourceVal !== undefined &&
      typeof sourceVal === "object" &&
      sourceVal !== null &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === "object" &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      ) as T[keyof T];
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T];
    }
  }
  return result;
}

/** Load config from YAML file, merged with defaults */
export async function loadConfig(configPath?: string): Promise<OpenClippyConfig> {
  const path = configPath ?? CONFIG_PATH;

  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...DEFAULT_CONFIG };
    }
    throw err;
  }

  const parsed = parseYaml(raw) as Partial<OpenClippyConfig> | null;

  if (!parsed || typeof parsed !== "object") {
    return { ...DEFAULT_CONFIG };
  }

  return deepMerge(DEFAULT_CONFIG, parsed);
}

/** Write config to YAML file */
export async function saveConfig(
  config: OpenClippyConfig,
  configPath?: string,
): Promise<void> {
  const path = configPath ?? CONFIG_PATH;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyYaml(config), "utf-8");
}

/** Ensure the state directory exists */
export async function ensureStateDir(): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
}
