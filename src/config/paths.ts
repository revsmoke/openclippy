import { homedir } from "node:os";
import { join } from "node:path";

export const STATE_DIR = join(homedir(), ".openclippy");
export const CONFIG_PATH = join(STATE_DIR, "config.yaml");
export const TOKEN_CACHE_PATH = join(STATE_DIR, "token-cache.json");
export const MEMORY_DB_PATH = join(STATE_DIR, "memory.db");
export const LOG_DIR = join(STATE_DIR, "logs");
export const LOG_PATH = join(LOG_DIR, "openclippy.log");
