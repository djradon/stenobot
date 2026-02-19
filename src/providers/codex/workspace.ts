import { readSessionMeta } from "./discovery.js";

/**
 * Resolve the workspace root for a Codex session file.
 * The cwd is embedded in session_meta.payload.cwd — no path decoding needed.
 */
export async function resolveCodexWorkspaceRoot(
  filePath: string,
): Promise<string | undefined> {
  const meta = await readSessionMeta(filePath);
  return meta?.cwd || undefined;
}
