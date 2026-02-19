import fs from "node:fs/promises";
import type { Provider } from "../base.js";
import type { Message, Session } from "../../types/index.js";
import { discoverClaudeSessions } from "./discovery.js";
import { parseClaudeMessages } from "./parser.js";
import { resolveWorkspaceRoot } from "./workspace.js";

export class ClaudeCodeProvider implements Provider {
  readonly name = "claude-code";

  constructor(private readonly sessionPaths?: string[]) {}

  discoverSessions(): AsyncIterable<Session> {
    return discoverClaudeSessions(this.sessionPaths);
  }

  parseMessages(
    sessionFilePath: string,
    fromOffset?: number,
  ): AsyncIterable<{ message: Message; offset: number }> {
    return parseClaudeMessages(sessionFilePath, fromOffset);
  }

  async resolveWorkspaceRoot(sessionFilePath: string): Promise<string | undefined> {
    return resolveWorkspaceRoot(sessionFilePath);
  }

  /** Return the first non-empty user message text (≤60 chars), stripping injected IDE tags */
  async getSessionLabel(filePath: string): Promise<string | null> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      for (const line of content.split("\n").slice(0, 30)) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as {
            type?: string;
            isSidechain?: boolean;
            message?: { content?: Array<{ type?: string; text?: string }> };
          };
          if (parsed.type === "user" && !parsed.isSidechain && parsed.message?.content) {
            for (const block of parsed.message.content) {
              if (block.type === "text" && block.text) {
                const cleaned = block.text
                  .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
                  .replace(/<ide_[^>]+>[\s\S]*?<\/ide_[^>]+>/g, "")
                  .trim();
                if (cleaned) return cleaned.replace(/\n/g, " ").slice(0, 60);
              }
            }
          }
        } catch { continue; }
      }
    } catch { /* ignore read errors */ }
    return null;
  }
}
