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

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readAlivePid(filePath: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const pid = parseInt(raw.trim(), 10);
    if (!Number.isFinite(pid)) return null;
    return isProcessAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function acquireDaemonLock(
  lockPath: string,
  pid: number,
): Promise<{ acquired: boolean; existingPid: number | null }> {
  try {
    await fs.writeFile(lockPath, String(pid), { flag: "wx" });
    return { acquired: true, existingPid: null };
  } catch {
    const existingPid = await readAlivePid(lockPath);
    if (existingPid !== null) {
      return { acquired: false, existingPid };
    }

    // Stale/corrupt lock: clear and retry once.
    await fs.rm(lockPath, { force: true });
    try {
      await fs.writeFile(lockPath, String(pid), { flag: "wx" });
      return { acquired: true, existingPid: null };
    } catch {
      const maybeLivePid = await readAlivePid(lockPath);
      return { acquired: false, existingPid: maybeLivePid };
    }
  }
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
  const lockFile = `${pidFile}.lock`;
  const pidDir = nodePath.dirname(pidFile);
  const logFile = expandHome(config.daemon.logFile);
  const logDir = nodePath.dirname(logFile);
  await fs.mkdir(pidDir, { recursive: true });
  await fs.mkdir(logDir, { recursive: true });

  // Exclusively create PID file to prevent dual-start race
  try {
    await fs.writeFile(pidFile, "starting", { flag: "wx" });
  } catch {
    // Prefer lock file as source of truth for a running daemon.
    const lockPid = await readAlivePid(lockFile);
    if (lockPid !== null) {
      // Heal stale/missing PID file for consistency.
      await fs.writeFile(pidFile, String(lockPid), "utf-8");
      this.process.stdout.write(
        `stenobot daemon is already running (PID: ${lockPid})\n`,
      );
      return;
    }

    // No live daemon lock. Treat any existing PID file as stale.
    try {
      const existing = await fs.readFile(pidFile, "utf-8");
      const existingPid = parseInt(existing.trim(), 10);
      if (!isNaN(existingPid) && isProcessAlive(existingPid)) {
        this.process.stderr.write(
          `PID file pointed to live process ${existingPid} but no daemon lock was found. Treating PID file as stale.\n`,
        );
      }
    } catch {
      // Could not read PID file
    }

    await fs.rm(lockFile, { force: true });
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

  const pidFile = expandHome(config.daemon.pidFile);
  const lockFile = `${pidFile}.lock`;
  const lock = await acquireDaemonLock(lockFile, ctx.process.pid);
  if (!lock.acquired) {
    logger.error("Another daemon instance is already running", {
      existingPid: lock.existingPid,
      lockFile,
    });
    ctx.process.exit(1);
    return;
  }

  logger.info("Daemon process started", {
    pid: ctx.process.pid,
    logFile,
  });

  const registry = new ProviderRegistry(config);
  const state = new StateManager();
  const monitor = new SessionMonitor(registry, state, config);

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

    try {
      await fs.rm(lockFile, { force: true });
    } catch (error) {
      logger.error("Error removing daemon lock file", { lockFile, error });
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

  try {
    await monitor.start();
  } catch (error) {
    logger.error("Failed to start session monitor", { error });
    await shutdown(1);
  }
}
