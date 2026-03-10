/**
 * Gateway CLI commands — start, stop, status for the OpenClippy daemon.
 *
 * Uses a PID file at ~/.openclippy/gateway.pid to track the running process.
 */

import { join } from "node:path";
import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { STATE_DIR } from "../config/paths.js";
import { loadConfig } from "../config/config.js";
import { Gateway } from "../gateway/server.js";

/** Path to the PID file for the gateway daemon. */
export const PID_FILE_PATH = join(STATE_DIR, "gateway.pid");

// ─── PID file helpers ────────────────────────────────────────────────────────

/** Write the given PID to the PID file. */
export async function writePidFile(pid: number): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(PID_FILE_PATH, String(pid), "utf-8");
}

/** Read the PID from the PID file. Returns null if missing or invalid. */
export async function readPidFile(): Promise<number | null> {
  if (!existsSync(PID_FILE_PATH)) return null;

  const raw = await readFile(PID_FILE_PATH, "utf-8");
  const pid = parseInt(raw.trim(), 10);
  return Number.isFinite(pid) ? pid : null;
}

/** Remove the PID file if it exists. */
export async function removePidFile(): Promise<void> {
  if (existsSync(PID_FILE_PATH)) {
    await unlink(PID_FILE_PATH);
  }
}

/** Check whether a process with the given PID is still alive. */
export function isProcessAlive(pid: number): boolean {
  try {
    // Sending signal 0 doesn't kill the process — it just checks existence.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

/** `openclippy gateway start` — Start the gateway daemon. */
export async function gatewayStartCommand(): Promise<void> {
  // Check if already running
  const existingPid = await readPidFile();
  if (existingPid !== null && isProcessAlive(existingPid)) {
    console.error(`Gateway is already running (PID ${existingPid}).`);
    return;
  }

  // Clean up stale PID file if process is dead
  if (existingPid !== null) {
    await removePidFile();
  }

  try {
    const config = await loadConfig();
    const gatewayConfig = config.gateway ?? {};
    const host = gatewayConfig.host ?? "localhost";

    const gateway = new Gateway(gatewayConfig);
    await gateway.start();

    // Write PID file
    await writePidFile(process.pid);

    console.log(`Gateway listening on http://${host}:${gateway.port}`);

    // Set up graceful shutdown handlers
    const shutdown = async () => {
      console.log("\nShutting down gateway...");
      await gateway.stop();
      await removePidFile();
      process.exit(0);
    };

    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to start gateway: ${message}`);
    process.exitCode = 1;
  }
}

/** `openclippy gateway stop` — Stop the running gateway daemon. */
export async function gatewayStopCommand(): Promise<void> {
  const pid = await readPidFile();

  if (pid === null) {
    console.log("Gateway is not running.");
    return;
  }

  if (!isProcessAlive(pid)) {
    console.log("Gateway is not running (stale PID file, cleaning up).");
    await removePidFile();
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    await removePidFile();
    console.log(`Gateway stopped (PID ${pid}).`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to stop gateway: ${message}`);
    process.exitCode = 1;
  }
}

/** `openclippy gateway status` — Check if the gateway is running. */
export async function gatewayStatusCommand(): Promise<void> {
  const pid = await readPidFile();

  if (pid === null) {
    console.log("Gateway is not running.");
    return;
  }

  if (!isProcessAlive(pid)) {
    console.log("Gateway is not running (stale PID file, cleaning up).");
    await removePidFile();
    return;
  }

  const config = await loadConfig();
  const port = config.gateway?.port ?? 4100;
  const host = config.gateway?.host ?? "localhost";

  console.log("Gateway is running:");
  console.log(`  PID:  ${pid}`);
  console.log(`  Host: ${host}`);
  console.log(`  Port: ${port}`);
}
