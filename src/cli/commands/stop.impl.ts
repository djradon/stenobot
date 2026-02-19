import type { LocalContext } from "../context.js";
import fs from "node:fs/promises";
import { expandHome } from "../../utils/paths.js";
import { loadConfig } from "../../config.js";

interface StopFlags {}

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

  try {
    process.kill(pid, "SIGTERM");
    await fs.rm(pidFile, { force: true });
    this.process.stdout.write("stenobot daemon stopped.\n");
  } catch {
    this.process.stderr.write(
      `Failed to stop daemon (PID ${pid}). It may have already exited.\n`,
    );
    await fs.rm(pidFile, { force: true });
  }
}
