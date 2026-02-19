import type { InChatCommand, InChatCommandName } from "../types/index.js";

const COMMAND_PATTERN = /::(\w+)\s*(.*)$/i;

const VALID_COMMANDS = new Set<InChatCommandName>([
  "record",
  "export",
  "capture",
  "stop",
]);

/** Commands that require a file path argument */
const FILE_COMMANDS = new Set<InChatCommandName>(["record", "capture", "export"]);

/**
 * Extract a file path from command args that may contain natural language.
 * Returns null if no recognizable file path token is found.
 *
 * Recognised forms (in order):
 *  - Quoted: "path/to file.md" or 'path/to file.md'
 *  - @-mention: @notes/file.md  (with optional <ide_opened_file> resolution)
 *  - .md path: notes/file.md    (with optional <ide_opened_file> resolution)
 *  - No-space token: my-notes, ~/notes, /abs/path, C:\Users\..., \\server\share\...
 *
 * The bridge word "to" is stripped when it is the first (and only) word before the path,
 * so "::capture to notes.md" works identically to "::capture notes.md".
 */
function extractPath(rawArgs: string, fullMessage: string): string | null {
  let trimmed = rawArgs.trim();
  if (!trimmed) return null;

  // Strip optional leading bridge word "to" (e.g. "::capture to notes.md")
  if (/^to\s+/i.test(trimmed)) {
    trimmed = trimmed.slice(trimmed.indexOf(" ")).trim();
    if (!trimmed) return null;
  }

  // Quoted path (allows spaces): "path/to/file" or 'path/to/file'
  const quotedMatch = /^["'](.+?)["']/.exec(trimmed);
  if (quotedMatch) {
    return quotedMatch[1]!;
  }

  // @-mention path (e.g. @notes/file.md)
  let visiblePath = "";
  const mentionMatch = /@([\w\-./~]+\.md)/i.exec(trimmed);
  if (mentionMatch) {
    visiblePath = mentionMatch[1]!;
  } else {
    // Plain .md path — leading alternative explicitly handles Windows drive letters (C:\...)
    const pathMatch = /([a-zA-Z]:[\w\-./~\\]*\.md|[\w\-./~\\]+\.md)/i.exec(trimmed);
    if (pathMatch) {
      visiblePath = pathMatch[1]!;
    }
  }

  // If a .md path was found, try to resolve it against an <ide_opened_file> tag
  if (visiblePath) {
    const ideFilePattern =
      /<ide_opened_file>The user opened the file ([^<]+) in the IDE\.<\/ide_opened_file>/gi;
    for (const match of fullMessage.matchAll(ideFilePattern)) {
      const fullPath = match[1]!.trim();
      if (fullPath.endsWith(visiblePath)) {
        return fullPath;
      }
    }
    return mentionMatch ? `@${visiblePath}` : visiblePath;
  }

  // Fallback: accept any token that has no whitespace (likely a bare filename/path).
  // This supports paths without .md (extension is added later by ensureMarkdownExtension),
  // absolute paths, Windows paths, UNC paths, tilde paths, etc.
  if (!/\s/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/** Detect all in-chat commands from a user message */
export function detectAllCommands(messageText: string): InChatCommand[] {
  const commands: InChatCommand[] = [];
  const lines = messageText.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = COMMAND_PATTERN.exec(trimmed);
    if (!match) continue;

    // Option B: skip commands wrapped in backticks (Markdown code spans)
    if (match.index > 0 && trimmed[match.index - 1] === "`") continue;

    const name = match[1]!.toLowerCase();
    if (!isValidCommand(name)) continue;

    const rawArgs = match[2]?.trim() ?? "";
    let args: string;

    if (FILE_COMMANDS.has(name as InChatCommandName)) {
      if (!rawArgs) {
        // No args at all: signal monitor to auto-generate a filename
        args = "";
      } else {
        const extracted = extractPath(rawArgs, messageText);
        if (extracted === null) {
          // Args present but no recognisable file path — likely prose context, skip
          continue;
        }
        args = extracted;
      }
    } else {
      // ::stop — no file path needed
      args = rawArgs;
    }

    commands.push({
      name: name as InChatCommandName,
      args,
      rawMessage: messageText,
    });
  }

  return commands;
}

/** Detect an in-chat command from a user message (returns first match) */
export function detectCommand(messageText: string): InChatCommand | null {
  const commands = detectAllCommands(messageText);
  return commands.length > 0 ? commands[0]! : null;
}

function isValidCommand(name: string): name is InChatCommandName {
  return VALID_COMMANDS.has(name as InChatCommandName);
}
