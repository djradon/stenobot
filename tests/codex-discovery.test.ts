import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { discoverCodexSessions } from "../src/providers/codex/discovery.js";

const FIXTURE_EXEC = path.join(import.meta.dirname, "fixtures", "codex-session-exec.jsonl");
const FIXTURE_VSCODE = path.join(import.meta.dirname, "fixtures", "codex-session-vscode-new.jsonl");
const FIXTURE_LEGACY = path.join(import.meta.dirname, "fixtures", "codex-session-legacy.jsonl");

async function collectSessions(sessionPaths: string[]) {
  const sessions = [];
  for await (const s of discoverCodexSessions(sessionPaths)) {
    sessions.push(s);
  }
  return sessions;
}

/** Create a minimal date-tree structure under a temp directory */
async function setupDateTree(baseDir: string, files: Record<string, string>): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(baseDir, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
  }
}

describe("discoverCodexSessions", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stenobot-codex-discovery-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true });
  });

  it("walks 3-level YYYY/MM/DD structure and finds .jsonl files", async () => {
    const vscodeMeta = (await fs.readFile(FIXTURE_VSCODE, "utf-8")).split("\n")[0]!;
    const legacyMeta = (await fs.readFile(FIXTURE_LEGACY, "utf-8")).split("\n")[0]!;

    await setupDateTree(tmpDir, {
      "2026/01/15/session-a.jsonl": vscodeMeta + "\n",
      "2026/02/10/session-b.jsonl": legacyMeta + "\n",
    });

    const sessions = await collectSessions([tmpDir]);
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.provider)).toEqual(["codex", "codex"]);
  });

  it("skips files with source === 'exec'", async () => {
    const execContent = await fs.readFile(FIXTURE_EXEC, "utf-8");
    const vscodeMeta = (await fs.readFile(FIXTURE_VSCODE, "utf-8")).split("\n")[0]!;

    await setupDateTree(tmpDir, {
      "2026/01/15/exec-session.jsonl": execContent,
      "2026/01/15/vscode-session.jsonl": vscodeMeta + "\n",
    });

    const sessions = await collectSessions([tmpDir]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe("sess-vscode-001");
  });

  it("reads workspaceRoot from session_meta.payload.cwd", async () => {
    const vscodeMeta = (await fs.readFile(FIXTURE_VSCODE, "utf-8")).split("\n")[0]!;

    await setupDateTree(tmpDir, {
      "2026/01/15/session.jsonl": vscodeMeta + "\n",
    });

    const sessions = await collectSessions([tmpDir]);
    expect(sessions[0]!.workspaceRoot).toBe("/home/user/project");
  });

  it("uses session_meta.payload.id as the session ID", async () => {
    const legacyMeta = (await fs.readFile(FIXTURE_LEGACY, "utf-8")).split("\n")[0]!;

    await setupDateTree(tmpDir, {
      "2026/01/15/some-other-name.jsonl": legacyMeta + "\n",
    });

    const sessions = await collectSessions([tmpDir]);
    expect(sessions[0]!.id).toBe("sess-cli-001");
  });

  it("returns empty when directory does not exist", async () => {
    const sessions = await collectSessions([path.join(tmpDir, "nonexistent")]);
    expect(sessions).toHaveLength(0);
  });

  it("skips non-.jsonl files", async () => {
    const vscodeMeta = (await fs.readFile(FIXTURE_VSCODE, "utf-8")).split("\n")[0]!;

    await setupDateTree(tmpDir, {
      "2026/01/15/notes.txt": "not a session",
      "2026/01/15/session.jsonl": vscodeMeta + "\n",
    });

    const sessions = await collectSessions([tmpDir]);
    expect(sessions).toHaveLength(1);
  });
});
