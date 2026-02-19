import type { LocalContext } from "../context.js";
import { StateManager } from "../../core/state.js";
import chalk from "chalk";
import fs from "node:fs/promises";
import path from "node:path";

interface CleanFlags {
  recordings?: number;
  sessions?: number;
  all?: boolean;
  dryRun?: boolean;
}

interface SessionMetadata {
  sessionId: string;
  firstUserMessage: string | null;
}

/** Extract session metadata from JSONL file */
async function getSessionMetadata(jsonlPath: string): Promise<SessionMetadata | null> {
  try {
    const content = await fs.readFile(jsonlPath, "utf-8");
    const lines = content.split("\n").slice(0, 20);

    let sessionId = "";
    let firstUserMessage: string | null = null;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);

        // Get session ID from any line
        if (!sessionId && parsed.sessionId) {
          sessionId = parsed.sessionId;
        }

        // Get first user message text (skip system tags)
        if (!firstUserMessage && parsed.type === "user" && parsed.message?.content) {
          for (const block of parsed.message.content) {
            if (block.type === "text" && block.text) {
              // Skip system reminders and tags
              const cleaned = block.text
                .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
                .replace(/<ide_[^>]+>[\s\S]*?<\/ide_[^>]+>/g, "")
                .trim();

              if (cleaned) {
                // Take first ~60 chars, strip newlines
                firstUserMessage = cleaned.replace(/\n/g, " ").slice(0, 60);
                break;
              }
            }
          }
        }

        if (sessionId && firstUserMessage) break;
      } catch {
        continue;
      }
    }

    return sessionId ? { sessionId, firstUserMessage } : null;
  } catch {
    return null;
  }
}

/** Format a session label as "claude: folder-name/"first message..." (session-id-short)" */
async function formatSessionLabel(filePath: string): Promise<string> {
  const metadata = await getSessionMetadata(filePath);

  // Extract encoded folder name from path
  const parts = path.normalize(filePath).split(path.sep);
  const projectsIdx = parts.indexOf("projects");
  const folderName = (projectsIdx >= 0 && projectsIdx + 1 < parts.length)
    ? parts[projectsIdx + 1]!
    : null;

  if (metadata) {
    const shortId = metadata.sessionId.slice(0, 8);
    const message = metadata.firstUserMessage
      ? `"${metadata.firstUserMessage}..."`
      : `(no message)`;
    const folder = folderName ? `${folderName}/` : "";
    return `claude: ${folder}${message} (${shortId})`;
  }

  return filePath;
}

export async function cleanImpl(
  this: LocalContext,
  flags: CleanFlags,
): Promise<void> {
  const { recordings: recordingsMaxAge, sessions: sessionsMaxAge, all, dryRun } = flags;

  if (!recordingsMaxAge && !sessionsMaxAge && !all) {
    this.process.stdout.write(
      chalk.yellow("No cleanup options specified.\n") +
      "Use --recordings <days>, --sessions <days>, or --all\n" +
      "Run 'stenobot clean --help' for more information.\n"
    );
    return;
  }

  const state = new StateManager();
  await state.load();

  const { sessions, recordings } = state.getState();
  const now = Date.now();

  let recordingsToRemove: string[] = [];
  let sessionsToRemove: string[] = [];

  if (all) {
    recordingsToRemove = Object.keys(recordings);
    sessionsToRemove = Object.keys(sessions);
  } else {
    // Find stale recordings
    if (recordingsMaxAge !== undefined) {
      const maxAgeMs = recordingsMaxAge * 24 * 60 * 60 * 1000;
      for (const [sessionId, recording] of Object.entries(recordings)) {
        const lastExported = new Date(recording.lastExported).getTime();
        if (now - lastExported > maxAgeMs) {
          recordingsToRemove.push(sessionId);
        }
      }
    }

    // Find stale sessions
    if (sessionsMaxAge !== undefined) {
      const maxAgeMs = sessionsMaxAge * 24 * 60 * 60 * 1000;
      for (const [sessionId, session] of Object.entries(sessions)) {
        const lastProcessed = new Date(session.lastProcessedTimestamp).getTime();
        if (now - lastProcessed > maxAgeMs) {
          sessionsToRemove.push(sessionId);
        }
      }
    }
  }

  if (recordingsToRemove.length === 0 && sessionsToRemove.length === 0) {
    this.process.stdout.write(chalk.green("Nothing to clean.\n"));
    return;
  }

  // Show what will be removed
  if (dryRun) {
    this.process.stdout.write(chalk.bold("Dry run - no changes will be made\n\n"));
  }

  if (recordingsToRemove.length > 0) {
    this.process.stdout.write(
      chalk.bold(`${dryRun ? "Would remove" : "Removing"} ${recordingsToRemove.length} recording(s):\n`)
    );
    for (const sessionId of recordingsToRemove) {
      const recording = recordings[sessionId]!;
      const session = sessions[sessionId];
      const label = session ? await formatSessionLabel(session.filePath) : sessionId.slice(0, 8) + "...";
      this.process.stdout.write(
        `  ${chalk.red("●")} ${chalk.cyan(label)}\n`
      );
      this.process.stdout.write(
        `    ${chalk.dim("→")} ${recording.outputFile}\n`
      );
    }
    this.process.stdout.write("\n");
  }

  if (sessionsToRemove.length > 0) {
    this.process.stdout.write(
      chalk.bold(`${dryRun ? "Would remove" : "Removing"} ${sessionsToRemove.length} tracked session(s):\n`)
    );
    for (const sessionId of sessionsToRemove) {
      const session = sessions[sessionId]!;
      const label = await formatSessionLabel(session.filePath);
      this.process.stdout.write(
        `  ${chalk.dim("○")} ${chalk.cyan(label)}\n`
      );
    }
    this.process.stdout.write("\n");
  }

  // Actually remove if not dry run
  if (!dryRun) {
    for (const sessionId of recordingsToRemove) {
      state.removeRecording(sessionId);
    }

    for (const sessionId of sessionsToRemove) {
      state.removeSession(sessionId);
    }

    await state.save();
    this.process.stdout.write(chalk.green("State cleaned successfully.\n"));
  }
}
