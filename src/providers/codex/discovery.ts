import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import readline from "node:readline";
import os from "node:os";
import type { Session } from "../../types/index.js";
import { expandHome } from "../../utils/paths.js";

/** Default Codex session directory */
const DEFAULT_SESSION_PATHS = [
  path.join(os.homedir(), ".codex", "sessions"),
];

/** Discover Codex sessions by scanning the date-tree directory structure */
export async function* discoverCodexSessions(
  sessionPaths?: string[],
): AsyncIterable<Session> {
  const dirs = sessionPaths?.map(expandHome) ?? DEFAULT_SESSION_PATHS;

  for (const baseDir of dirs) {
    yield* scanDateTree(baseDir);
  }
}

/** Walk YYYY/MM/DD/ directories and yield session objects */
async function* scanDateTree(baseDir: string): AsyncIterable<Session> {
  let years: string[];
  try {
    years = await fs.readdir(baseDir);
  } catch {
    return; // Directory doesn't exist — skip
  }

  for (const year of years) {
    const yearPath = path.join(baseDir, year);
    if (!(await isDirectory(yearPath))) continue;

    let months: string[];
    try {
      months = await fs.readdir(yearPath);
    } catch {
      continue;
    }

    for (const month of months) {
      const monthPath = path.join(yearPath, month);
      if (!(await isDirectory(monthPath))) continue;

      let days: string[];
      try {
        days = await fs.readdir(monthPath);
      } catch {
        continue;
      }

      for (const day of days) {
        const dayPath = path.join(monthPath, day);
        if (!(await isDirectory(dayPath))) continue;

        let files: string[];
        try {
          files = await fs.readdir(dayPath);
        } catch {
          continue;
        }

        for (const file of files) {
          if (!file.endsWith(".jsonl")) continue;

          const filePath = path.join(dayPath, file);
          const stat = await fs.stat(filePath).catch(() => null);
          if (!stat?.isFile()) continue;

          const meta = await readSessionMeta(filePath);
          if (!meta) continue;
          if (meta.source === "exec") continue; // Skip sandboxed sub-agent stubs

          yield {
            id: meta.id,
            provider: "codex",
            filePath,
            lastModified: stat.mtime,
            workspaceRoot: meta.cwd || undefined,
          };
        }
      }
    }
  }
}

async function isDirectory(p: string): Promise<boolean> {
  const stat = await fs.stat(p).catch(() => null);
  return stat?.isDirectory() ?? false;
}

interface SessionMeta {
  id: string;
  source: string;
  cwd: string;
}

/** Read the first line of a Codex JSONL file and parse session_meta */
export async function readSessionMeta(filePath: string): Promise<SessionMeta | null> {
  return new Promise((resolve) => {
    let settled = false;

    const done = (result: SessionMeta | null) => {
      if (settled) return;
      settled = true;
      rl.close();
      stream.destroy();
      resolve(result);
    };

    const stream = fsSync.createReadStream(filePath, { encoding: "utf-8" });
    stream.on("error", () => done(null));

    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line) as { type?: string; payload?: Record<string, unknown> };
        if (parsed.type === "session_meta" && parsed.payload) {
          done({
            id: String(parsed.payload["id"] ?? ""),
            source: String(parsed.payload["source"] ?? ""),
            cwd: String(parsed.payload["cwd"] ?? ""),
          });
        } else {
          done(null); // First non-empty line is not session_meta
        }
      } catch {
        done(null);
      }
    });

    rl.on("close", () => done(null));
  });
}
