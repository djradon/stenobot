import type { InChatCommand, InChatCommandName } from "../types/index.js";

const COMMAND_PATTERN = /::(\w+)\s*(.*)$/i;

const VALID_COMMANDS = new Set<InChatCommandName>([
  "record",
  "export",
  "capture",
  "stop",
]);

/** Extract a file path from args that may contain natural language */
function extractPath(rawArgs: string, fullMessage: string): string {
  const trimmed = rawArgs.trim();
  if (!trimmed) return "";

  // Extract the visible path from the command args first
  let visiblePath = "";

  // Look for @-mention paths (e.g., "@notes/file.md")
  const mentionMatch = /@([\w\-./~]+\.md)/i.exec(trimmed);
  if (mentionMatch) {
    visiblePath = mentionMatch[1]!; // Without the @ prefix
  } else {
    // Look for file paths with .md extension
    const pathMatch = /([\w\-./~]+\.md)/i.exec(trimmed);
    if (pathMatch) {
      visiblePath = pathMatch[1]!;
    }
  }

  // If we found a visible path, try to match it with an <ide_opened_file> tag
  if (visiblePath) {
    // Find all <ide_opened_file> tags in the message
    const ideFilePattern = /<ide_opened_file>The user opened the file ([^<]+) in the IDE\.<\/ide_opened_file>/gi;
    const matches = fullMessage.matchAll(ideFilePattern);

    for (const match of matches) {
      const fullPath = match[1]!.trim();
      // Check if this IDE file matches our visible path
      // The visible path should be a suffix of the full path
      if (fullPath.endsWith(visiblePath)) {
        return fullPath;
      }
    }

    // No matching IDE file found, return the visible path with @ prefix if it had one
    return mentionMatch ? `@${visiblePath}` : visiblePath;
  }

  // Return the whole thing if no path pattern found (backward compatible)
  return trimmed;
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

    const name = match[1]!.toLowerCase();
    if (!isValidCommand(name)) continue;

    const rawArgs = match[2]?.trim() ?? "";
    const args = extractPath(rawArgs, messageText);

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
