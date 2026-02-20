import type { LocalContext } from "../context.js";
import fs from "node:fs/promises";
import { expandHome } from "../../utils/paths.js";
import { loadConfig } from "../../config.js";
import { setTimeout as delay } from "node:timers/promises";

interface StopFlags {}

const STOP_TIMEOUT_MS = 5000;
const STOP_POLL_INTERVAL_MS = 100;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await delay(STOP_POLL_INTERVAL_MS);
  }
  return !isProcessAlive(pid);
}

export async function stopImpl(
  this: LocalContext,
  _flags: StopFlags,
): Promise<void> {
  const config = await loadConfig();
  const pidFile = expandHome(config.daemon.pidFile);

  let pid: number;
  try {
    const raw = await fs.readFile(pidFile, "utf-8");
    pid = parseInt(raw.trim(), 10);
    if (isNaN(pid)) {
      this.process.stderr.write("PID file is corrupt. Removing it.\n");
      await fs.rm(pidFile, { force: true });
      return;
    }
  } catch {
    this.process.stderr.write("No running stenobot daemon found.\n");
    return;
  }

  if (!isProcessAlive(pid)) {
    this.process.stderr.write(
      `No running stenobot daemon found (stale PID file: ${pid}). Removing it.\n`,
    );
    await fs.rm(pidFile, { force: true });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      await fs.rm(pidFile, { force: true });
      this.process.stderr.write(
        `Daemon process ${pid} was not running. Removed stale PID file.\n`,
      );
      return;
    }

    this.process.stderr.write(
      `Failed to stop daemon (PID ${pid}). ${String(error)}\n`,
    );
    return;
  }

  const stopped = await waitForProcessExit(pid, STOP_TIMEOUT_MS);
  if (!stopped) {
    this.process.stderr.write(
      `Sent SIGTERM to daemon (PID ${pid}) but it is still running after ${STOP_TIMEOUT_MS}ms. Aborting stop.\n`,
    );
    return;
  }

  await fs.rm(pidFile, { force: true });
  this.process.stdout.write("stenobot daemon stopped.\n");
}
