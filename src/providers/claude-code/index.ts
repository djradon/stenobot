import type { Provider } from "../base.js";
import type { Message, Session } from "../../types/index.js";
import { discoverClaudeSessions } from "./discovery.js";
import { parseClaudeMessages } from "./parser.js";

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
}
