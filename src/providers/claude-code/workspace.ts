import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";

const execAsync = promisify(exec);

/**
 * Attempt to find the workspace root for a session file.
 *
 * Strategy:
 * 1. Extract the encoded folder name from the session path
 * 2. Check common workspace locations (~/hub/<project>, ~/<project>)
 * 3. Try to find git repository root
 * 4. Return undefined if unable to determine
 */
export async function resolveWorkspaceRoot(sessionFilePath: string): Promise<string | undefined> {
  // Extract encoded folder name from session path
  // e.g., ~/.claude-personal/projects/-home-djradon-hub-semantic-flow-sflo/session.jsonl
  const parts = path.normalize(sessionFilePath).split(path.sep);
  const projectsIdx = parts.indexOf("projects");

  if (projectsIdx < 0 || projectsIdx + 1 >= parts.length) {
    return undefined;
  }

  const encodedFolder = parts[projectsIdx + 1]!;

  // Try to find workspace using common patterns
  // Pattern 1: Look for project name hints in the encoded path
  // -home-djradon-hub-semantic-flow-sflo might indicate project "sflo" in ~/hub/semantic-flow/

  // Extract the last segment (often the project name)
  const segments = encodedFolder.split("-").filter(s => s);
  if (segments.length === 0) {
    return undefined;
  }

  const projectName = segments[segments.length - 1]!;
  const home = process.env.HOME || process.env.USERPROFILE || "";

  // Try common workspace patterns
  const candidates = [
    // Pattern: ~/hub/<project>
    path.join(home, "hub", projectName),
    // Pattern: ~/hub/*/<project> - search one level deep
    ...await findInDirectory(path.join(home, "hub"), projectName, 1),
    // Pattern: ~/<project>
    path.join(home, projectName),
  ];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        // Verify it's a git repository (good signal it's the right place)
        const gitRoot = await findGitRoot(candidate);
        if (gitRoot) {
          return gitRoot;
        }
        // Even if no git, use it if it exists
        return candidate;
      }
    } catch {
      // Directory doesn't exist, try next
      continue;
    }
  }

  return undefined;
}

/** Find git repository root from a given directory */
async function findGitRoot(startPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync("git rev-parse --show-toplevel", {
      cwd: startPath,
      timeout: 1000,
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/** Search for a directory name within a parent, up to maxDepth levels */
async function findInDirectory(
  parentDir: string,
  targetName: string,
  maxDepth: number,
): Promise<string[]> {
  if (maxDepth <= 0) return [];

  try {
    const entries = await fs.readdir(parentDir, { withFileTypes: true });
    const results: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const fullPath = path.join(parentDir, entry.name);

      // Check if this directory matches the target name
      if (entry.name === targetName) {
        results.push(fullPath);
      }

      // Recurse into subdirectories if depth allows
      if (maxDepth > 1) {
        const subResults = await findInDirectory(fullPath, targetName, maxDepth - 1);
        for (const r of subResults) {
          if (!results.includes(r)) results.push(r);
        }
      }
    }

    return results;
  } catch {
    return [];
  }
}
