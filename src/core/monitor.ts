import { watch, type FSWatcher } from "chokidar";
import type { Provider } from "../providers/base.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { StateManager } from "./state.js";
import { detectAllCommands } from "./detector.js";
import { exportToMarkdown } from "./exporter.js";
import { ensureMarkdownExtension, expandHome } from "../utils/paths.js";
import { logger } from "../utils/logger.js";
import type { StenobotConfig, Message } from "../types/index.js";
import fs from "node:fs/promises";
import path from "node:path";

/** Convert a string to a URL-safe slug for use in auto-generated filenames */
function slugify(text: string): string {
  const result = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return result || "session";
}

export class SessionMonitor {
  private watchers = new Map<string, FSWatcher>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly state: StateManager,
    private readonly config: StenobotConfig,
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
    const now = Date.now();
    const maxAge = this.config.monitoring.maxSessionAge;
    const activeFilePaths = new Set<string>();

    for (const provider of this.getEnabledProviders()) {
      try {
        for await (const session of provider.discoverSessions()) {
          const age = now - session.lastModified.getTime();
          if (age <= maxAge) {
            activeFilePaths.add(session.filePath);
            if (!this.watchers.has(session.filePath)) {
              this.watchSession(provider, session.filePath, session.id);
            }
          }
        }
      } catch (error) {
        logger.error("Error discovering sessions", {
          provider: provider.name,
          error,
        });
      }
    }

    this.pruneStaleWatchers(activeFilePaths);
  }

  /** Remove watchers for sessions that are no longer recently active */
  private pruneStaleWatchers(activeFilePaths: Set<string>): void {
    for (const [filePath, watcher] of this.watchers) {
      if (!activeFilePaths.has(filePath)) {
        logger.debug("Removing stale watcher", { filePath });
        void watcher.close();
        this.watchers.delete(filePath);
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

    // Catch up on any changes that accumulated while this session wasn't watched
    void this.processSession(provider, filePath, sessionId);
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

    // Track commands that affect incremental export behavior
    let skipIncrementalExport = false;
    let recordStartIndex = -1;

    try {
      for await (const { message, offset } of provider.parseMessages(
        filePath,
        fromOffset,
      )) {
        newMessages.push(message);
        latestOffset = offset;

        // Check user messages for in-chat commands
        if (message.role === "user") {
          const commands = detectAllCommands(message.content);
          for (const command of commands) {
            // ::capture and ::export do their own full export — skip incremental
            if (command.name === "capture" || command.name === "export") {
              skipIncrementalExport = true;
            }
            // ::record is forward-only — only export messages after this point
            if (command.name === "record") {
              recordStartIndex = newMessages.length;
            }
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
    if (recording && !skipIncrementalExport) {
      const messagesToExport =
        recordStartIndex >= 0 ? newMessages.slice(recordStartIndex) : newMessages;

      if (messagesToExport.length > 0) {
        try {
          await exportToMarkdown(messagesToExport, recording.outputFile, {
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
      case "capture": {
        const outputFile = args
          ? await this.resolveOutputPath(args, provider, filePath)
          : await this.generateAutoPath(filePath, provider);
        logger.info("Capturing session", { sessionId, outputFile });

        await this.exportFullSession(provider, filePath, outputFile);

        this.state.setRecording(sessionId, {
          outputFile,
          started: new Date().toISOString(),
          lastExported: new Date().toISOString(),
        });
        break;
      }

      case "record": {
        const outputFile = args
          ? await this.resolveOutputPath(args, provider, filePath)
          : await this.generateAutoPath(filePath, provider);
        logger.info("Starting recording", { sessionId, outputFile });

        this.state.setRecording(sessionId, {
          outputFile,
          started: new Date().toISOString(),
          lastExported: new Date().toISOString(),
        });
        break;
      }

      case "export": {
        const outputFile = args
          ? await this.resolveOutputPath(args, provider, filePath)
          : await this.generateAutoPath(filePath, provider);
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
  private async resolveOutputPath(
    rawPath: string,
    provider: Provider,
    sessionFilePath: string,
  ): Promise<string> {
    let resolved = rawPath.trim();

    // Strip @ prefix if present (VSCode @-mention)
    if (resolved.startsWith("@")) {
      resolved = resolved.slice(1);
    }

    resolved = expandHome(resolved);
    resolved = ensureMarkdownExtension(resolved);

    // If relative, try to resolve against workspace root, fall back to cwd
    if (!path.isAbsolute(resolved)) {
      const workspaceRoot = provider.resolveWorkspaceRoot
        ? await provider.resolveWorkspaceRoot(sessionFilePath)
        : undefined;
      const base = workspaceRoot ?? process.cwd();

      // Check if the relative path starts with the workspace's base name
      // e.g., "sflo/documentation/file.md" when workspace is "/path/to/sflo"
      // This happens when users type "@sflo/..." in VSCode
      if (workspaceRoot) {
        const workspaceBaseName = path.basename(workspaceRoot);
        const prefix = workspaceBaseName + path.sep;
        const normalizedResolved = path.normalize(resolved);
        if (normalizedResolved.startsWith(prefix)) {
          // Strip the redundant prefix
          resolved = normalizedResolved.slice(prefix.length);
        }
      }

      resolved = path.resolve(base, resolved);
    }

    return resolved;
  }

  /** Generate an output path when no filename was given, using a timestamp + session slug */
  private async generateAutoPath(
    sessionFilePath: string,
    provider: Provider,
  ): Promise<string> {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const firstMessage = await this.getFirstUserMessage(sessionFilePath);
    const slug = slugify(firstMessage ?? "session");
    const filename = `${date}-${slug}.md`;

    const workspaceRoot = provider.resolveWorkspaceRoot
      ? await provider.resolveWorkspaceRoot(sessionFilePath)
      : undefined;
    return path.resolve(workspaceRoot ?? process.cwd(), filename);
  }

  /** Read the first non-system user message text from a session JSONL file */
  private async getFirstUserMessage(filePath: string): Promise<string | null> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      for (const line of content.split("\n").slice(0, 30)) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "user" && parsed.message?.content) {
            for (const block of parsed.message.content) {
              if (block.type === "text" && block.text) {
                const cleaned = (block.text as string)
                  .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
                  .replace(/<ide_[^>]+>[\s\S]*?<\/ide_[^>]+>/g, "")
                  .trim();
                if (cleaned) return cleaned.replace(/\n/g, " ").slice(0, 80);
              }
            }
          }
        } catch { continue; }
      }
    } catch { /* ignore read errors */ }
    return null;
  }

  private getEnabledProviders(): Provider[] {
    const enabledNames = Object.entries(this.config.providers)
      .filter(([, cfg]) => cfg.enabled)
      .map(([name]) => name);
    return this.registry.getEnabled(enabledNames);
  }
}
