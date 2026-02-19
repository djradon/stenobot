import path from "node:path";
import os from "node:os";

/** Expand ~ to the user's home directory */
export function expandHome(filePath: string): string {
  if (filePath.startsWith("~")) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

/** Default stenobot config/state directory */
export function getStenobotDir(): string {
  return path.join(os.homedir(), ".stenobot");
}

/** Ensure a file path has a .md extension */
export function ensureMarkdownExtension(filePath: string): string {
  if (!path.extname(filePath)) {
    return `${filePath}.md`;
  }
  return filePath;
}
