import type { LocalContext } from "../context.js";
import { ProviderRegistry } from "../../providers/registry.js";
import { StateManager } from "../../core/state.js";
import { SessionMonitor } from "../../core/monitor.js";
import { loadConfig, generateDefaultConfig } from "../../config.js";
import { expandHome } from "../../utils/paths.js";
import { configureLogger, logger } from "../../utils/logger.js";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import nodePath from "node:path";
import { spawn } from "node:child_process";

interface StartFlags {}

interface ChildStartupResult {
  exited: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

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
  const logFile = expandHome(config.daemon.logFile);
  const logDir = nodePath.dirname(logFile);
  await fs.mkdir(pidDir, { recursive: true });
  await fs.mkdir(logDir, { recursive: true });

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

  let logHandle: FileHandle;
  try {
    logHandle = await fs.open(logFile, "a");
  } catch (error) {
    await fs.rm(pidFile, { force: true });
    this.process.stderr.write(
      `Failed to open daemon log file at ${logFile}: ${String(error)}\n`,
    );
    return;
  }

  let child: ReturnType<typeof spawn>;
  try {
    const childArgv = [...this.process.execArgv, ...this.process.argv.slice(1)];
    // Redirect daemon stdout/stderr to daemon.logFile so early startup crashes are captured.
    child = spawn(this.process.execPath, childArgv, {
      detached: true,
      stdio: ["ignore", logHandle.fd, logHandle.fd],
      env: { ...this.process.env, STENOBOT_DAEMON_MODE: "1" },
    });
  } catch (error) {
    await logHandle.close();
    await fs.rm(pidFile, { force: true });
    this.process.stderr.write(`Failed to spawn daemon process: ${String(error)}\n`);
    return;
  }

  await logHandle.close();

  if (child.pid === undefined) {
    await fs.rm(pidFile, { force: true });
    this.process.stderr.write("Failed to spawn daemon process.\n");
    return;
  }

  const startup = await waitForChildStartup(child, 400);
  if (startup.exited) {
    await fs.rm(pidFile, { force: true });
    if (startup.error) {
      this.process.stderr.write(
        `Daemon failed to start: ${startup.error.message}. Check ${logFile}\n`,
      );
      return;
    }

    const details = startup.signal
      ? `signal ${startup.signal}`
      : `exit code ${startup.code ?? "unknown"}`;
    this.process.stderr.write(
      `Daemon exited during startup (${details}). Check ${logFile}\n`,
    );
    return;
  }

  child.unref();
  await fs.writeFile(pidFile, String(child.pid), "utf-8");
  this.process.stdout.write(
    `stenobot daemon started (PID: ${child.pid})\nlogs: ${logFile}\n`,
  );
}

function waitForChildStartup(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<ChildStartupResult> {
  return new Promise((resolve) => {
    let resolved = false;
    const settle = (result: ChildStartupResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(
      () => settle({ exited: false, code: null, signal: null }),
      timeoutMs,
    );

    child.once("error", (error) => settle({ exited: true, code: null, signal: null, error }));
    child.once("exit", (code, signal) => settle({ exited: true, code, signal }));
  });
}

async function runDaemon(ctx: LocalContext): Promise<void> {
  const config = await loadConfig();
  const logFile = expandHome(config.daemon.logFile);
  await configureLogger({ logFile, includeConsole: false });

  logger.info("Daemon process started", {
    pid: ctx.process.pid,
    logFile,
  });

  const registry = new ProviderRegistry(config);
  const state = new StateManager();
  const monitor = new SessionMonitor(registry, state, config);

  const pidFile = expandHome(config.daemon.pidFile);
  let shuttingDown = false;

  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    let finalExitCode = exitCode;

    try {
      await monitor.stop();
    } catch (error) {
      logger.error("Error stopping monitor", { error });
      finalExitCode = 1;
    }

    try {
      await fs.rm(pidFile, { force: true });
    } catch (error) {
      logger.error("Error removing daemon PID file", { pidFile, error });
      finalExitCode = 1;
    }

    logger.info("Daemon process exiting", {
      pid: ctx.process.pid,
      exitCode: finalExitCode,
    });
    ctx.process.exit(finalExitCode);
  };

  ctx.process.on("SIGINT", () => void shutdown(0));
  ctx.process.on("SIGTERM", () => void shutdown(0));
  ctx.process.on("uncaughtException", (error) => {
    logger.error("Unhandled daemon exception", { error });
    void shutdown(1);
  });
  ctx.process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled daemon rejection", { reason });
    void shutdown(1);
  });

  await monitor.start();
}
