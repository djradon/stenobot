import type { LocalContext } from "../context.js";
import { ProviderRegistry } from "../../providers/registry.js";
import { StateManager } from "../../core/state.js";
import { SessionMonitor } from "../../core/monitor.js";
import { loadConfig } from "../../config.js";

interface StartFlags {}

export async function startImpl(
  this: LocalContext,
  _flags: StartFlags,
): Promise<void> {
  this.process.stdout.write("Starting clogger daemon...\n");

  const config = await loadConfig();
  const registry = new ProviderRegistry(config);
  const state = new StateManager();
  const monitor = new SessionMonitor(registry, state, config);

  await monitor.start();

  this.process.stdout.write("clogger is monitoring for sessions.\n");

  // Keep the process alive
  const shutdown = async () => {
    this.process.stdout.write("\nShutting down...\n");
    await monitor.stop();
    this.process.exit(0);
  };

  this.process.on("SIGINT", () => void shutdown());
  this.process.on("SIGTERM", () => void shutdown());
}
