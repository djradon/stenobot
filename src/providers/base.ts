import type { Message, Session } from "../types/index.js";

/** Interface that all LLM providers must implement */
export interface Provider {
  /** Human-readable provider name (e.g., "claude-code") */
  readonly name: string;

  /** Discover active conversation sessions */
  discoverSessions(): AsyncIterable<Session>;

  /** Parse messages from a session file, starting from a byte offset */
  parseMessages(
    sessionFilePath: string,
    fromOffset?: number,
  ): AsyncIterable<{ message: Message; offset: number }>;

  /** Optional: resolve the workspace root directory for a session */
  resolveWorkspaceRoot?(sessionFilePath: string): Promise<string | undefined>;

  /** Optional: return a short human-readable label for a session (first user message, ≤60 chars) */
  getSessionLabel?(filePath: string): Promise<string | null>;
}
