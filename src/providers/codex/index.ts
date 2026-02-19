import fs from "node:fs/promises";
import type { Provider } from "../base.js";
import type { Message, Session } from "../../types/index.js";
import { discoverCodexSessions } from "./discovery.js";
import { parseCodexMessages } from "./parser.js";
import { resolveCodexWorkspaceRoot } from "./workspace.js";

/** Strip VSCode IDE preamble from a user message (inline for label extraction) */
function stripIdePreamble(text: string): string {
  const marker = "## My request for Codex:\n";
  const idx = text.indexOf(marker);
  if (idx >= 0) {
    return text.slice(idx + marker.length).trim();
  }
  return text.trim();
}

export class CodexProvider implements Provider {
  readonly name = "codex";

  constructor(private readonly sessionPaths?: string[]) {}

  discoverSessions(): AsyncIterable<Session> {
    return discoverCodexSessions(this.sessionPaths);
  }

  parseMessages(
    sessionFilePath: string,
    fromOffset?: number,
  ): AsyncIterable<{ message: Message; offset: number }> {
    return parseCodexMessages(sessionFilePath, fromOffset);
  }

  async resolveWorkspaceRoot(sessionFilePath: string): Promise<string | undefined> {
    return resolveCodexWorkspaceRoot(sessionFilePath);
  }

  /**
   * Scan the first N lines of a session file for the first user message.
   * Returns up to 60 chars with IDE preamble stripped, or null if not found.
   */
  async getSessionLabel(filePath: string): Promise<string | null> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      for (const line of content.split("\n").slice(0, 30)) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as {
            type?: string;
            payload?: { type?: string; source?: string; message?: string };
          };

          // Skip exec sessions entirely
          if (parsed.type === "session_meta" && parsed.payload?.source === "exec") {
            return null;
          }

          if (
            parsed.type === "event_msg" &&
            parsed.payload?.type === "user_message" &&
            parsed.payload.message
          ) {
            const stripped = stripIdePreamble(parsed.payload.message);
            return stripped ? stripped.replace(/\n/g, " ").slice(0, 60) : null;
          }
        } catch { continue; }
      }
    } catch { /* ignore read errors (file not found, permission denied, etc.) */ }
    return null;
  }
}
