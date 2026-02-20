import type { LocalContext } from "../context.js";
import { loadConfig } from "../../config.js";
import { expandHome } from "../../utils/paths.js";
import { stopImpl } from "./stop.impl.js";
import { startImpl } from "./start.impl.js";
import fs from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

interface RestartFlags {}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function getRunningPid(pidFile: string): Promise<number | null> {
  // Daemon lock is authoritative for "actually running" state.
  const lockFile = `${pidFile}.lock`;
  try {
    const lockRaw = await fs.readFile(lockFile, "utf-8");
    const lockPid = parseInt(lockRaw.trim(), 10);
    if (Number.isFinite(lockPid) && isProcessAlive(lockPid)) return lockPid;
  } catch {
    // No lock or unreadable lock.
  }

  // No live lock => no confirmed running daemon.
  return null;
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await delay(100);
  }
  return !isProcessAlive(pid);
}

export async function restartImpl(
  this: LocalContext,
  _flags: RestartFlags,
): Promise<void> {
  const config = await loadConfig();
  const pidFile = expandHome(config.daemon.pidFile);
  const existingPid = await getRunningPid(pidFile);

  if (existingPid !== null) {
    await stopImpl.call(this, {});

    const stopped = await waitForProcessExit(existingPid, 5000);
    if (!stopped) {
      this.process.stderr.write(
        `Daemon process ${existingPid} is still running after stop. Aborting restart.\n`,
      );
      return;
    }
  }

  await startImpl.call(this, {});
}
