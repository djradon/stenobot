import { watch, type FSWatcher } from "chokidar";
import type { Provider } from "../providers/base.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { StateManager } from "./state.js";
import { detectCommand } from "./detector.js";
import { exportToMarkdown } from "./exporter.js";
import { ensureMarkdownExtension, expandHome } from "../utils/paths.js";
import { logger } from "../utils/logger.js";
import type { CloggerConfig, Message } from "../types/index.js";
import path from "node:path";

export class SessionMonitor {
  private watchers = new Map<string, FSWatcher>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly state: StateManager,
    private readonly config: CloggerConfig,
  ) {}

  /** Start monitoring all enabled providers */
  async start(): Promise<void> {
    logger.info("Starting session monitor");

    await this.state.load();

    // Initial session discovery
    await this.discoverAndWatch();

    // Poll for new sessions periodically
    this.pollTimer = setInterval(
      () => void this.discoverAndWatch(),
      this.config.monitoring.pollInterval,
    );

    // Persist state periodically
    this.saveTimer = setInterval(
      () => void this.state.save(),
      this.config.monitoring.stateUpdateInterval,
    );
  }

  /** Stop monitoring and clean up */
  async stop(): Promise<void> {
    logger.info("Stopping session monitor");

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }

    for (const [key, watcher] of this.watchers) {
      await watcher.close();
      this.watchers.delete(key);
    }

    await this.state.save();
  }

  /** Discover sessions from all enabled providers and set up watchers */
  private async discoverAndWatch(): Promise<void> {
    const enabledProviders = this.getEnabledProviders();

    for (const provider of enabledProviders) {
      try {
        for await (const session of provider.discoverSessions()) {
          if (!this.watchers.has(session.filePath)) {
            this.watchSession(provider, session.filePath, session.id);
          }
        }
      } catch (error) {
        logger.error("Error discovering sessions", {
          provider: provider.name,
          error,
        });
      }
    }
  }

  /** Set up a file watcher for a session file */
  private watchSession(
    provider: Provider,
    filePath: string,
    sessionId: string,
  ): void {
    logger.info("Watching session", { sessionId, filePath });

    const watcher = watch(filePath, {
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });

    watcher.on("change", () => {
      void this.processSession(provider, filePath, sessionId);
    });

    this.watchers.set(filePath, watcher);
  }

  /** Process new messages in a session file */
  private async processSession(
    provider: Provider,
    filePath: string,
    sessionId: string,
  ): Promise<void> {
    const sessionState = this.state.getState().sessions[sessionId];
    const fromOffset = sessionState?.lastProcessedOffset ?? 0;

    const newMessages: Message[] = [];
    let latestOffset = fromOffset;

    try {
      for await (const { message, offset } of provider.parseMessages(
        filePath,
        fromOffset,
      )) {
        newMessages.push(message);
        latestOffset = offset;

        // Check user messages for in-chat commands
        if (message.role === "user") {
          const command = detectCommand(message.content);
          if (command) {
            await this.handleCommand(command.name, command.args, sessionId, provider, filePath);
          }
        }
      }
    } catch (error) {
      logger.error("Error processing session", { sessionId, error });
      return;
    }

    if (newMessages.length === 0) return;

    // Update state with latest offset
    this.state.updateSession(sessionId, {
      filePath,
      lastProcessedOffset: latestOffset,
      lastProcessedTimestamp: new Date().toISOString(),
    });

    // If we're recording this session, export the new messages
    const recording = this.state.getRecording(sessionId);
    if (recording) {
      try {
        await exportToMarkdown(newMessages, recording.outputFile, {
          metadata: this.config.metadata,
        });
        this.state.setRecording(sessionId, {
          ...recording,
          lastExported: new Date().toISOString(),
        });
      } catch (error) {
        logger.error("Error exporting messages", { sessionId, error });
      }
    }
  }

  /** Export the full session from the beginning to a file (overwrite mode) */
  private async exportFullSession(
    provider: Provider,
    filePath: string,
    outputFile: string,
  ): Promise<void> {
    const allMessages: Message[] = [];
    for await (const { message } of provider.parseMessages(filePath, 0)) {
      allMessages.push(message);
    }

    await exportToMarkdown(allMessages, outputFile, {
      metadata: this.config.metadata,
      mode: "overwrite",
    });
  }

  /** Handle an in-chat command */
  private async handleCommand(
    name: string,
    args: string,
    sessionId: string,
    provider: Provider,
    filePath: string,
  ): Promise<void> {
    switch (name) {
      case "record":
      case "capture": {
        const outputFile = this.resolveOutputPath(args, provider, filePath);
        logger.info("Starting recording", { sessionId, outputFile, command: name });

        await this.exportFullSession(provider, filePath, outputFile);

        this.state.setRecording(sessionId, {
          outputFile,
          started: new Date().toISOString(),
          lastExported: new Date().toISOString(),
        });
        break;
      }

      case "export": {
        const outputFile = this.resolveOutputPath(args, provider, filePath);
        logger.info("Exporting session", { sessionId, outputFile });

        await this.exportFullSession(provider, filePath, outputFile);
        break;
      }

      case "stop": {
        logger.info("Stopping recording", { sessionId });
        this.state.removeRecording(sessionId);
        break;
      }

      default:
        logger.debug("Unhandled in-chat command", { name, args });
    }
  }

  /** Resolve a recording target path from command args */
  private resolveOutputPath(
    rawPath: string,
    provider: Provider,
    sessionFilePath: string,
  ): string {
    let resolved = rawPath.trim();

    // Strip @ prefix if present (VSCode @-mention)
    if (resolved.startsWith("@")) {
      resolved = resolved.slice(1);
    }

    resolved = expandHome(resolved);
    resolved = ensureMarkdownExtension(resolved);

    // If relative, resolve against workspace root or output directory
    if (!path.isAbsolute(resolved)) {
      const workspaceRoot = provider.resolveWorkspaceRoot?.(sessionFilePath);
      const base = workspaceRoot ?? expandHome(this.config.outputDirectory);
      resolved = path.resolve(base, resolved);
    }

    return resolved;
  }

  private getEnabledProviders(): Provider[] {
    const enabledNames = Object.entries(this.config.providers)
      .filter(([, cfg]) => cfg.enabled)
      .map(([name]) => name);
    return this.registry.getEnabled(enabledNames);
  }
}
