import type { LocalContext } from "../context.js";
import { ProviderRegistry } from "../../providers/registry.js";
import { StateManager } from "../../core/state.js";
import { SessionMonitor } from "../../core/monitor.js";
import { loadConfig, generateDefaultConfig } from "../../config.js";
import { expandHome } from "../../utils/paths.js";
import fs from "node:fs/promises";
import nodePath from "node:path";

interface StartFlags {}

export async function startImpl(
  this: LocalContext,
  _flags: StartFlags,
): Promise<void> {
  this.process.stdout.write("Starting clogger daemon...\n");

  const configResult = await generateDefaultConfig();
  if (configResult.created) {
    this.process.stdout.write(`Config file created: ${configResult.path}\n`);
  }

  const config = await loadConfig();
  const registry = new ProviderRegistry(config);
  const state = new StateManager();
  const monitor = new SessionMonitor(registry, state, config);

  await monitor.start();

  // Write PID file so `clogger stop` can find us
  const pidFile = expandHome(config.daemon.pidFile);
  await fs.mkdir(nodePath.dirname(pidFile), { recursive: true });
  await fs.writeFile(pidFile, String(this.process.pid), "utf-8");

  this.process.stdout.write("clogger is monitoring for sessions.\n");

  // Keep the process alive
  const shutdown = async () => {
    this.process.stdout.write("\nShutting down...\n");
    await monitor.stop();
    await fs.rm(pidFile, { force: true });
    this.process.exit(0);
  };

  this.process.on("SIGINT", () => void shutdown());
  this.process.on("SIGTERM", () => void shutdown());
}
