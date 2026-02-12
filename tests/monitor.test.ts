import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionMonitor } from "../src/core/monitor.js";
import { StateManager } from "../src/core/state.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import type { Provider } from "../src/providers/base.js";
import type { Message, Session, CloggerConfig } from "../src/types/index.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const FIXTURE = path.join(import.meta.dirname, "fixtures", "claude-session.jsonl");

function makeConfig(overrides: Partial<CloggerConfig> = {}): CloggerConfig {
  return {
    providers: { "test-provider": { enabled: true } },
    outputDirectory: "/tmp/clogger-test-output",
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
    ...overrides,
  };
}

/** Create a mock provider that reads from our test fixture */
function makeTestProvider(sessionFilePath: string, sessionId: string): Provider {
  // Use the real Claude Code parser on a real fixture
  return {
    name: "test-provider",
    async *discoverSessions(): AsyncIterable<Session> {
      yield {
        id: sessionId,
        provider: "test-provider",
        filePath: sessionFilePath,
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clogger-monitor-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionMonitor command handling", () => {
  it("::record triggers full session export and sets recording state", async () => {
    const stateDir = path.join(tmpDir, "state");
    const outputFile = path.join(tmpDir, "record-output.md");
    const state = new StateManager(stateDir);
    await state.load();

    // Copy fixture to a temp session file
    const sessionFile = path.join(tmpDir, "session.jsonl");
    await fs.copyFile(FIXTURE, sessionFile);

    // Append a ::record command to the session file (as a user message)
    const recordCmd = JSON.stringify({
      type: "user",
      uuid: "cmd-record",
      timestamp: "2026-02-11T00:00:00Z",
      message: {
        role: "user",
        content: [{ type: "text", text: `::record ${outputFile}` }],
      },
    });
    await fs.appendFile(sessionFile, "\n" + recordCmd + "\n");

    const provider = makeTestProvider(sessionFile, "test-session");
    const config = makeConfig();
    const registry = new ProviderRegistry();
    registry.register(provider);

    const monitor = new SessionMonitor(registry, state, config);

    // Manually trigger session processing (bypass file watcher)
    // @ts-expect-error accessing private method for testing
    await monitor.processSession(provider, sessionFile, "test-session");

    // Recording should be set
    const recording = state.getRecording("test-session");
    expect(recording).toBeDefined();
    expect(recording!.outputFile).toBe(outputFile);

    // Output file should exist with content
    const content = await fs.readFile(outputFile, "utf-8");
    expect(content).toMatch(/^---\n/); // has frontmatter
    expect(content).toContain("# "); // has message headings
  });

  it("::export triggers full session export without recording state", async () => {
    const stateDir = path.join(tmpDir, "state");
    const outputFile = path.join(tmpDir, "export-output.md");
    const state = new StateManager(stateDir);
    await state.load();

    const sessionFile = path.join(tmpDir, "session.jsonl");
    await fs.copyFile(FIXTURE, sessionFile);

    const exportCmd = JSON.stringify({
      type: "user",
      uuid: "cmd-export",
      timestamp: "2026-02-11T00:00:00Z",
      message: {
        role: "user",
        content: [{ type: "text", text: `::export ${outputFile}` }],
      },
    });
    await fs.appendFile(sessionFile, "\n" + exportCmd + "\n");

    const provider = makeTestProvider(sessionFile, "test-session");
    const config = makeConfig();
    const registry = new ProviderRegistry();
    registry.register(provider);

    const monitor = new SessionMonitor(registry, state, config);

    // @ts-expect-error accessing private method for testing
    await monitor.processSession(provider, sessionFile, "test-session");

    // No recording state should be set
    expect(state.getRecording("test-session")).toBeUndefined();

    // But output file should exist
    const content = await fs.readFile(outputFile, "utf-8");
    expect(content).toMatch(/^---\n/);
  });

  it("::capture triggers full session export and sets recording state", async () => {
    const stateDir = path.join(tmpDir, "state");
    const outputFile = path.join(tmpDir, "capture-output.md");
    const state = new StateManager(stateDir);
    await state.load();

    const sessionFile = path.join(tmpDir, "session.jsonl");
    await fs.copyFile(FIXTURE, sessionFile);

    const captureCmd = JSON.stringify({
      type: "user",
      uuid: "cmd-capture",
      timestamp: "2026-02-11T00:00:00Z",
      message: {
        role: "user",
        content: [{ type: "text", text: `::capture ${outputFile}` }],
      },
    });
    await fs.appendFile(sessionFile, "\n" + captureCmd + "\n");

    const provider = makeTestProvider(sessionFile, "test-session");
    const config = makeConfig();
    const registry = new ProviderRegistry();
    registry.register(provider);

    const monitor = new SessionMonitor(registry, state, config);

    // @ts-expect-error accessing private method for testing
    await monitor.processSession(provider, sessionFile, "test-session");

    // Recording should be set (like ::record)
    const recording = state.getRecording("test-session");
    expect(recording).toBeDefined();
    expect(recording!.outputFile).toBe(outputFile);

    // Output file should exist
    const content = await fs.readFile(outputFile, "utf-8");
    expect(content).toMatch(/^---\n/);
  });

  it("::stop removes recording state", async () => {
    const stateDir = path.join(tmpDir, "state");
    const state = new StateManager(stateDir);
    await state.load();

    // Pre-set a recording
    state.setRecording("test-session", {
      outputFile: "/tmp/existing.md",
      started: "2026-02-11T00:00:00Z",
      lastExported: "2026-02-11T00:00:00Z",
    });

    const sessionFile = path.join(tmpDir, "session.jsonl");
    await fs.copyFile(FIXTURE, sessionFile);

    const stopCmd = JSON.stringify({
      type: "user",
      uuid: "cmd-stop",
      timestamp: "2026-02-11T00:00:00Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "::stop" }],
      },
    });
    await fs.appendFile(sessionFile, "\n" + stopCmd + "\n");

    const provider = makeTestProvider(sessionFile, "test-session");
    const config = makeConfig();
    const registry = new ProviderRegistry();
    registry.register(provider);

    const monitor = new SessionMonitor(registry, state, config);

    // @ts-expect-error accessing private method for testing
    await monitor.processSession(provider, sessionFile, "test-session");

    expect(state.getRecording("test-session")).toBeUndefined();
  });

  it("incremental export appends new messages to existing recording", async () => {
    const stateDir = path.join(tmpDir, "state");
    const outputFile = path.join(tmpDir, "incremental-output.md");
    const state = new StateManager(stateDir);
    await state.load();

    const sessionFile = path.join(tmpDir, "session.jsonl");
    await fs.copyFile(FIXTURE, sessionFile);

    const provider = makeTestProvider(sessionFile, "test-session");
    const config = makeConfig();
    const registry = new ProviderRegistry();
    registry.register(provider);

    const monitor = new SessionMonitor(registry, state, config);

    // First: process the full session and set up recording
    state.setRecording("test-session", {
      outputFile,
      started: "2026-02-11T00:00:00Z",
      lastExported: "2026-02-11T00:00:00Z",
    });

    // @ts-expect-error accessing private method for testing
    await monitor.processSession(provider, sessionFile, "test-session");

    const firstContent = await fs.readFile(outputFile, "utf-8");
    const firstLength = firstContent.length;

    // Now append a new message to the session file
    const newMsg = JSON.stringify({
      type: "user",
      uuid: "new-msg-1",
      timestamp: "2026-02-11T01:00:00Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "This is a new follow-up message." }],
      },
    });
    await fs.appendFile(sessionFile, "\n" + newMsg + "\n");

    // Process again — should only process the new message
    // @ts-expect-error accessing private method for testing
    await monitor.processSession(provider, sessionFile, "test-session");

    const secondContent = await fs.readFile(outputFile, "utf-8");
    expect(secondContent.length).toBeGreaterThan(firstLength);
    expect(secondContent).toContain("This is a new follow-up message.");
  });

  it("resolves output paths with @-mention prefix and tilde", async () => {
    const stateDir = path.join(tmpDir, "state");
    const state = new StateManager(stateDir);
    await state.load();

    const sessionFile = path.join(tmpDir, "session.jsonl");
    await fs.copyFile(FIXTURE, sessionFile);

    // Use a command with @ prefix and relative path
    const homePath = path.join(os.homedir(), "clogger-test-at-resolve.md");
    const recordCmd = JSON.stringify({
      type: "user",
      uuid: "cmd-at",
      timestamp: "2026-02-11T00:00:00Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "::record @~/clogger-test-at-resolve" }],
      },
    });
    await fs.appendFile(sessionFile, "\n" + recordCmd + "\n");

    const provider = makeTestProvider(sessionFile, "test-session");
    const config = makeConfig();
    const registry = new ProviderRegistry();
    registry.register(provider);

    const monitor = new SessionMonitor(registry, state, config);

    // @ts-expect-error accessing private method for testing
    await monitor.processSession(provider, sessionFile, "test-session");

    const recording = state.getRecording("test-session");
    expect(recording).toBeDefined();
    // Should have resolved ~ and added .md extension
    expect(recording!.outputFile).toBe(homePath);

    // Clean up the created file
    await fs.rm(homePath, { force: true });
  });
});
