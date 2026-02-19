import fs from "node:fs/promises";
import path from "node:path";
import { parse as yamlParse } from "yaml";
import type { StenobotConfig } from "./types/index.js";
import { getStenobotDir } from "./utils/paths.js";

const CONFIG_FILE = "config.yaml";

const DEFAULT_CONFIG: StenobotConfig = {
  providers: {
    "claude-code": {
      enabled: true,
      sessionPaths: [
        "~/.claude/projects/",
        "~/.claude-personal/projects/",
      ],
    },
  },
  outputDirectory: "~/stenobot-output",
  fileNamingTemplate: "conv.{provider}.{date}.{session-short}.md",
  metadata: {
    includeTimestamps: true,
    includeToolCalls: false,
    includeThinking: false,
    italicizeUserMessages: false,
    truncateToolResults: 1000,
  },
  monitoring: {
    pollInterval: 60000,
    stateUpdateInterval: 10000,
    maxSessionAge: 600000,
  },
  daemon: {
    pidFile: "~/.stenobot/daemon.pid",
    logFile: "~/.stenobot/daemon.log",
  },
};

function buildConfigTemplate(): string {
  const win = process.platform === "win32";
  // Use single-quoted YAML strings on Windows so backslashes need no escaping
  const q = win ? "'" : '"';
  const slash = (p: string) => (win ? p.replace(/\//g, "\\") : p);

  return `# Stenobot Configuration
# All settings shown with their defaults. CLI flags override on a per-invocation basis.

providers:
  claude-code:
    enabled: true
    # Paths where Claude Code stores session files
    sessionPaths:
      - ${q}${slash("~/.claude/projects/")}${q}
      - ${q}${slash("~/.claude-personal/projects/")}${q}
    # Optional: set a default export path for this provider
    # exportPath: ${q}${slash("~/my-exports")}${q}

# Default directory for exported markdown files
outputDirectory: ${q}${slash("~/stenobot-output")}${q}

# Filename template for auto-generated exports
# Tokens: {provider}, {date}, {session-short}
fileNamingTemplate: "conv.{provider}.{date}.{session-short}.md"

metadata:
  # Include turn timestamps in headings
  includeTimestamps: true
  # Include tool call details (reads, searches, etc.)
  includeToolCalls: false
  # Include Claude's extended thinking blocks
  includeThinking: false
  # Render user messages in italics
  italicizeUserMessages: false
  # Truncate tool result output to N characters (0 = no truncation)
  truncateToolResults: 1000

monitoring:
  # How often to poll for session file changes (milliseconds)
  pollInterval: 60000
  # How often to write daemon state updates (milliseconds)
  stateUpdateInterval: 10000
  # Sessions older than this are considered stale (milliseconds)
  maxSessionAge: 600000

daemon:
  pidFile: ${q}${slash("~/.stenobot/daemon.pid")}${q}
  logFile: ${q}${slash("~/.stenobot/daemon.log")}${q}
`;
}

function deepMerge<T>(defaults: T, overrides: Partial<T>): T {
  const result = { ...defaults } as T;
  for (const key of Object.keys(overrides as object) as (keyof T)[]) {
    const val = overrides[key];
    if (
      val !== undefined &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      val !== null
    ) {
      result[key] = deepMerge(result[key] as object, val as object) as T[keyof T];
    } else if (val !== undefined) {
      result[key] = val as T[keyof T];
    }
  }
  return result;
}

/** Load config from disk, falling back to defaults */
export async function loadConfig(): Promise<StenobotConfig> {
  const configPath = path.join(getStenobotDir(), CONFIG_FILE);

  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const userConfig = yamlParse(raw) as Partial<StenobotConfig>;
    return deepMerge(DEFAULT_CONFIG, userConfig);
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Write default config to disk. Returns whether the file was created. */
export async function generateDefaultConfig(
  force = false,
): Promise<{ created: boolean; path: string }> {
  const configPath = path.join(getStenobotDir(), CONFIG_FILE);

  if (!force) {
    try {
      await fs.access(configPath);
      return { created: false, path: configPath };
    } catch {
      // doesn't exist, proceed
    }
  }

  await fs.mkdir(getStenobotDir(), { recursive: true });
  await fs.writeFile(configPath, buildConfigTemplate(), "utf-8");
  return { created: true, path: configPath };
}
