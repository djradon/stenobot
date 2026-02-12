import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionMonitor } from "../src/core/monitor.js";
import { StateManager } from "../src/core/state.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import type { Provider } from "../src/providers/base.js";
import type { Session, CloggerConfig } from "../src/types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal JSONL fixture for a user message */
function userEntry(uuid: string, text: string, timestamp: string): string {
  return JSON.stringify({
    type: "user",
    uuid,
    timestamp,
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

/** Minimal JSONL fixture for an assistant message */
function assistantEntry(
  uuid: string,
  text: string,
  timestamp: string,
  model = "claude-opus-4-6",
): string {
  return JSON.stringify({
    type: "assistant",
    uuid,
    timestamp,
    message: {
      role: "assistant",
      model,
      content: [{ type: "text", text }],
    },
  });
}

function makeConfig(tmpDir: string): CloggerConfig {
  return {
    providers: { "test-provider": { enabled: true } },
    outputDirectory: tmpDir,
    fileNamingTemplate: "conv.{provider}.{date}.{session-short}.md",
    metadata: {
      includeTimestamps: true,
      includeToolCalls: false,
      includeThinking: false,
      italicizeUserMessages: true,
      truncateToolResults: 1000,
    },
    recording: { captureMode: "full-session", multipleTargets: "replace" },
    monitoring: { pollInterval: 60000, stateUpdateInterval: 60000 },
    daemon: { pidFile: "~/.clogger/daemon.pid", logFile: "~/.clogger/daemon.log" },
  };
}

function makeProvider(sessionFile: string, sessionId: string): Provider {
  return {
    name: "test-provider",
    async *discoverSessions(): AsyncIterable<Session> {
      yield {
        id: sessionId,
        provider: "test-provider",
        filePath: sessionFile,
        lastModified: new Date(),
      };
    },
    async *parseMessages(filePath: string, fromOffset?: number) {
      const { parseClaudeMessages } = await import(
        "../src/providers/claude-code/parser.js"
      );
      yield* parseClaudeMessages(filePath, fromOffset);
    },
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clogger-e2e-daemon-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("e2e daemon lifecycle", () => {
  it("processes ::record, appends new messages, then ::stop", async () => {
    const stateDir = path.join(tmpDir, "state");
    const sessionFile = path.join(tmpDir, "session.jsonl");
    const outputFile = path.join(tmpDir, "output.md");

    // Build a session JSONL with a conversation + ::record command
    const lines = [
      userEntry("u1", "Hello, can you help?", "2026-02-11T10:00:00Z"),
      assistantEntry("a1", "Of course! What do you need?", "2026-02-11T10:00:05Z"),
      userEntry("u2", `::record ${outputFile}`, "2026-02-11T10:01:00Z"),
      assistantEntry("a2", "Recording started.", "2026-02-11T10:01:02Z"),
    ];
    await fs.writeFile(sessionFile, lines.join("\n") + "\n");

    const state = new StateManager(stateDir);
    await state.load();
    const provider = makeProvider(sessionFile, "test-session");
    const config = makeConfig(tmpDir);
    const registry = new ProviderRegistry();
    registry.register(provider);

    const monitor = new SessionMonitor(registry, state, config);

    // Process the session — should detect ::record and export full session
    // @ts-expect-error accessing private method for testing
    await monitor.processSession(provider, sessionFile, "test-session");

    // Verify: output file exists with full session content
    let content = await fs.readFile(outputFile, "utf-8");
    expect(content).toMatch(/^---\n/); // frontmatter
    expect(content).toContain("*Hello, can you help?*");
    expect(content).toContain("Of course! What do you need?");
    expect(content).toContain("Recording started.");

    // Recording state should be active
    expect(state.getRecording("test-session")).toBeDefined();

    const firstLength = content.length;

    // Append new messages to the session
    const newLines = [
      userEntry("u3", "Can you write a function?", "2026-02-11T10:05:00Z"),
      assistantEntry("a3", "Sure, here is a function.", "2026-02-11T10:05:05Z"),
    ];
    await fs.appendFile(sessionFile, newLines.join("\n") + "\n");

    // Process again — should append only new messages
    // @ts-expect-error accessing private method for testing
    await monitor.processSession(provider, sessionFile, "test-session");

    content = await fs.readFile(outputFile, "utf-8");
    expect(content.length).toBeGreaterThan(firstLength);
    expect(content).toContain("*Can you write a function?*");
    expect(content).toContain("Sure, here is a function.");

    // Count frontmatter delimiters — should only have the original pair
    const delimiterCount = (content.match(/^---$/gm) ?? []).length;
    expect(delimiterCount).toBe(2);

    // Append ::stop command
    const stopLine = userEntry("u4", "::stop", "2026-02-11T10:10:00Z");
    await fs.appendFile(sessionFile, stopLine + "\n");

    // @ts-expect-error accessing private method for testing
    await monitor.processSession(provider, sessionFile, "test-session");

    // Recording should be removed
    expect(state.getRecording("test-session")).toBeUndefined();

    // State should persist correctly
    await state.save();
    const state2 = new StateManager(stateDir);
    await state2.load();
    expect(state2.getRecording("test-session")).toBeUndefined();
    expect(state2.getState().sessions["test-session"]).toBeDefined();
  });
});
