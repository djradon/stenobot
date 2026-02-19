/** Common message format normalized across all providers */
export interface Message {
  /** Unique ID for this message (provider-specific) */
  id: string;
  /** Who sent the message */
  role: "user" | "assistant" | "system";
  /** Plain text content of the message */
  content: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Model identifier, e.g. "claude-opus-4-6" (assistant only) */
  model?: string;
  /** Tool calls made during this message (assistant only) */
  toolCalls?: ToolCall[];
  /** Thinking/reasoning blocks (assistant only) */
  thinkingBlocks?: ThinkingBlock[];
}

export interface ToolCall {
  /** Tool use ID for linking results (e.g., "toolu_01LZUe...") */
  id: string;
  /** Tool name (e.g., "Bash", "Read", "Edit") */
  name: string;
  /** Brief description of what the tool call did */
  description?: string;
  /** Tool input parameters (may be truncated) */
  input?: Record<string, unknown>;
  /** Tool result (may be truncated) */
  result?: string;
}

export interface ThinkingBlock {
  content: string;
}

/** A discovered LLM conversation session */
export interface Session {
  /** Unique session identifier */
  id: string;
  /** Provider that owns this session */
  provider: string;
  /** Path to the session's conversation file */
  filePath: string;
  /** When the session was last modified */
  lastModified: Date;
  /** Workspace root directory (if determinable) */
  workspaceRoot?: string;
}

/** Persisted state for crash recovery */
export interface AppState {
  sessions: Record<
    string,
    {
      filePath: string;
      provider?: string;
      lastProcessedOffset: number;
      lastProcessedTimestamp: string;
      recordingTarget?: string;
      recordingStarted?: string;
    }
  >;
  recordings: Record<
    string,
    {
      outputFile: string;
      started: string;
      lastExported: string;
    }
  >;
}

/** In-chat commands recognized by the detector */
export type InChatCommandName =
  | "record"
  | "export"
  | "capture"
  | "stop";

export interface InChatCommand {
  name: InChatCommandName;
  args: string;
  /** The raw message text that contained the command */
  rawMessage: string;
}

/** Configuration schema */
export interface StenobotConfig {
  providers: Record<
    string,
    {
      enabled: boolean;
      sessionPaths?: string[];
      exportPath?: string;
    }
  >;
  outputDirectory: string;
  fileNamingTemplate: string;
  metadata: {
    includeTimestamps: boolean;
    includeToolCalls: boolean;
    includeThinking: boolean;
    italicizeUserMessages: boolean;
    truncateToolResults: number;
  };
  monitoring: {
    pollInterval: number;
    stateUpdateInterval: number;
    maxSessionAge: number;
  };
  daemon: {
    pidFile: string;
    logFile: string;
  };
}
