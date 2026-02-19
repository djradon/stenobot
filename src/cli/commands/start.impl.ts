import type { LocalContext } from "../context.js";
import { ProviderRegistry } from "../../providers/registry.js";
import { StateManager } from "../../core/state.js";
import { SessionMonitor } from "../../core/monitor.js";
import { loadConfig, generateDefaultConfig } from "../../config.js";
import { expandHome } from "../../utils/paths.js";
import fs from "node:fs/promises";
import nodePath from "node:path";
import { spawn } from "node:child_process";

interface StartFlags {}

export async function startImpl(
  this: LocalContext,
  _flags: StartFlags,
): Promise<void> {
  // Daemon worker path: we are the background child process
  if (process.env["STENOBOT_DAEMON_MODE"] === "1") {
    await runDaemon(this);
    return;
  }

  // Parent path: spawn the daemon and return to the shell
  const configResult = await generateDefaultConfig();
  if (configResult.created) {
    this.process.stdout.write(`Config file created: ${configResult.path}\n`);
  }

  const config = await loadConfig();
  const pidFile = expandHome(config.daemon.pidFile);
  const pidDir = nodePath.dirname(pidFile);
  await fs.mkdir(pidDir, { recursive: true });

  // Exclusively create PID file to prevent dual-start race
  try {
    await fs.writeFile(pidFile, "starting", { flag: "wx" });
  } catch {
    // File already exists — check if the daemon is genuinely running
    try {
      const existing = await fs.readFile(pidFile, "utf-8");
      const existingPid = parseInt(existing.trim(), 10);
      if (!isNaN(existingPid)) {
        try {
          process.kill(existingPid, 0);
          this.process.stdout.write(
            `stenobot daemon is already running (PID: ${existingPid})\n`,
          );
          return;
        } catch {
          // Stale PID — process is gone
        }
      }
    } catch {
      // Could not read PID file
    }
    // Stale or corrupt PID file — clear it and try once more
    await fs.rm(pidFile, { force: true });
    try {
      await fs.writeFile(pidFile, "starting", { flag: "wx" });
    } catch {
      this.process.stderr.write(
        "Could not acquire PID file. Is another `stenobot start` running?\n",
      );
      return;
    }
  }

  // Spawn detached child with STENOBOT_DAEMON_MODE=1
  const child = spawn(this.process.execPath, this.process.argv.slice(1), {
    detached: true,
    stdio: "ignore",
    env: { ...this.process.env, STENOBOT_DAEMON_MODE: "1" },
  });

  if (child.pid === undefined) {
    await fs.rm(pidFile, { force: true });
    this.process.stderr.write("Failed to spawn daemon process.\n");
    return;
  }

  child.unref();
  await fs.writeFile(pidFile, String(child.pid), "utf-8");
  this.process.stdout.write(`stenobot daemon started (PID: ${child.pid})\n`);
}

async function runDaemon(ctx: LocalContext): Promise<void> {
  const config = await loadConfig();
  const registry = new ProviderRegistry(config);
  const state = new StateManager();
  const monitor = new SessionMonitor(registry, state, config);

  await monitor.start();

  const pidFile = expandHome(config.daemon.pidFile);

  const shutdown = async () => {
    await monitor.stop();
    await fs.rm(pidFile, { force: true });
    ctx.process.exit(0);
  };

  ctx.process.on("SIGINT", () => void shutdown());
  ctx.process.on("SIGTERM", () => void shutdown());
}
