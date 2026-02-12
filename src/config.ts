import fs from "node:fs/promises";
import path from "node:path";
import type { CloggerConfig } from "./types/index.js";
import { getCloggerDir } from "./utils/paths.js";

const CONFIG_FILE = "config.json";

const DEFAULT_CONFIG: CloggerConfig = {
  providers: {
    "claude-code": {
      enabled: true,
      sessionPaths: [
        "~/.claude/projects/",
        "~/.claude-personal/projects/",
      ],
    },
  },
  outputDirectory: "~/clogger-output",
  fileNamingTemplate: "conv.{provider}.{date}.{session-short}.md",
  metadata: {
    includeTimestamps: true,
    includeToolCalls: false,
    includeThinking: false,
    italicizeUserMessages: false,
    truncateToolResults: 1000,
  },
  recording: {
    captureMode: "full-session",
    multipleTargets: "replace",
  },
  monitoring: {
    pollInterval: 5000,
    stateUpdateInterval: 10000,
  },
  daemon: {
    pidFile: "~/.clogger/daemon.pid",
    logFile: "~/.clogger/daemon.log",
  },
};

/** Load config from disk, falling back to defaults */
export async function loadConfig(): Promise<CloggerConfig> {
  const configPath = path.join(getCloggerDir(), CONFIG_FILE);

  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const userConfig = JSON.parse(raw) as Partial<CloggerConfig>;
    return { ...DEFAULT_CONFIG, ...userConfig };
  } catch {
    return DEFAULT_CONFIG;
  }
}
