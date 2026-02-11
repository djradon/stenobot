import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import type { Session } from "../../types/index.js";
import { expandHome } from "../../utils/paths.js";

/** Default Claude Code session directories */
const DEFAULT_SESSION_PATHS = [
  path.join(os.homedir(), ".claude", "projects"),
  path.join(os.homedir(), ".claude-personal", "projects"),
];

/** Discover active Claude Code sessions by scanning project directories */
export async function* discoverClaudeSessions(
  sessionPaths?: string[],
): AsyncIterable<Session> {
  const dirs = sessionPaths?.map(expandHome) ?? DEFAULT_SESSION_PATHS;

  for (const projectsDir of dirs) {
    yield* scanProjectsDir(projectsDir);
  }
}

/** Scan a single projects directory for sessions */
async function* scanProjectsDir(projectsDir: string): AsyncIterable<Session> {
  let projectDirs: string[];
  try {
    projectDirs = await fs.readdir(projectsDir);
  } catch {
    return; // Directory doesn't exist — skip
  }

  for (const projectDir of projectDirs) {
    const projectPath = path.join(projectsDir, projectDir);
    const stat = await fs.stat(projectPath).catch(() => null);
    if (!stat?.isDirectory()) continue;

    let entries: string[];
    try {
      entries = await fs.readdir(projectPath);
    } catch {
      continue;
    }

    for (const file of entries) {
      if (!file.endsWith(".jsonl")) continue;

      const filePath = path.join(projectPath, file);
      const fileStat = await fs.stat(filePath).catch(() => null);
      if (!fileStat) continue;

      const sessionId = path.basename(file, ".jsonl");

      yield {
        id: sessionId,
        provider: "claude-code",
        filePath,
        lastModified: fileStat.mtime,
        workspaceRoot: decodeProjectDir(projectDir),
      };
    }
  }
}

/** Decode a Claude Code project directory name back to a path */
function decodeProjectDir(encoded: string): string {
  // Claude Code encodes paths by replacing path separators with hyphens
  // e.g., "-home-user-project" → "/home/user/project"
  return encoded.replace(/-/g, path.sep);
}
