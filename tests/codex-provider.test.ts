import { describe, it, expect } from "vitest";
import path from "node:path";
import { CodexProvider } from "../src/providers/codex/index.js";
import { ClaudeCodeProvider } from "../src/providers/claude-code/index.js";

const FIXTURE_VSCODE = path.join(import.meta.dirname, "fixtures", "codex-session-vscode-new.jsonl");
const FIXTURE_LEGACY = path.join(import.meta.dirname, "fixtures", "codex-session-legacy.jsonl");
const FIXTURE_EXEC = path.join(import.meta.dirname, "fixtures", "codex-session-exec.jsonl");
const FIXTURE_CLAUDE = path.join(import.meta.dirname, "fixtures", "claude-session.jsonl");

describe("CodexProvider.getSessionLabel", () => {
  const provider = new CodexProvider();

  it("returns stripped user message text from VSCode fixture (preamble removed)", async () => {
    const label = await provider.getSessionLabel(FIXTURE_VSCODE);
    expect(label).not.toBeNull();
    // Should NOT include the IDE preamble
    expect(label).not.toContain("# Context from my IDE setup");
    expect(label).not.toContain("## Active file");
    // Should include the ::record command and actual request text
    expect(label!).toContain("::record");
  });

  it("returns plain user message text from legacy fixture (no preamble)", async () => {
    const label = await provider.getSessionLabel(FIXTURE_LEGACY);
    expect(label).toBe("How do I use async/await in JavaScript?");
  });

  it("returns null for exec fixture", async () => {
    const label = await provider.getSessionLabel(FIXTURE_EXEC);
    expect(label).toBeNull();
  });

  it("returns null for a nonexistent file", async () => {
    const label = await provider.getSessionLabel("/does/not/exist.jsonl");
    expect(label).toBeNull();
  });

  it("truncates to 60 characters", async () => {
    const label = await provider.getSessionLabel(FIXTURE_VSCODE);
    expect(label).not.toBeNull();
    expect(label!.length).toBeLessThanOrEqual(60);
  });
});

describe("ClaudeCodeProvider.getSessionLabel (regression)", () => {
  const provider = new ClaudeCodeProvider();

  it("returns stripped user message text from Claude fixture", async () => {
    const label = await provider.getSessionLabel(FIXTURE_CLAUDE);
    expect(label).not.toBeNull();
    expect(label).toContain("authentication");
  });

  it("truncates to 60 characters", async () => {
    const label = await provider.getSessionLabel(FIXTURE_CLAUDE);
    expect(label).not.toBeNull();
    expect(label!.length).toBeLessThanOrEqual(60);
  });

  it("returns null for a nonexistent file", async () => {
    const label = await provider.getSessionLabel("/does/not/exist.jsonl");
    expect(label).toBeNull();
  });
});
