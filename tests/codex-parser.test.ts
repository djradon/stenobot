import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { parseCodexMessages } from "../src/providers/codex/parser.js";

const FIXTURE_VSCODE = path.join(import.meta.dirname, "fixtures", "codex-session-vscode-new.jsonl");
const FIXTURE_LEGACY = path.join(import.meta.dirname, "fixtures", "codex-session-legacy.jsonl");

async function collectMessages(filePath: string, fromOffset?: number) {
  const items: Awaited<
    ReturnType<typeof parseCodexMessages> extends AsyncIterable<infer T> ? T : never
  >[] = [];
  for await (const item of parseCodexMessages(filePath, fromOffset)) {
    items.push(item);
  }
  return items;
}

// ---------------------------------------------------------------------------
// VSCode fixture (≥0.104.0-alpha.1)
// ---------------------------------------------------------------------------

describe("parseCodexMessages — VSCode fixture", () => {
  it("yields user message with preamble stripped and ::record command preserved", async () => {
    const results = await collectMessages(FIXTURE_VSCODE);
    const user1 = results[0]!;
    expect(user1.message.role).toBe("user");
    expect(user1.message.content).toContain("::record @documentation/notes/test.md");
    expect(user1.message.content).toContain("Help me set up authentication");
    // IDE preamble must be stripped
    expect(user1.message.content).not.toContain("## Active file:");
    expect(user1.message.content).not.toContain("# Context from my IDE setup");
  });

  it("takes assistant message from final_answer, not intermediate agent_message", async () => {
    const results = await collectMessages(FIXTURE_VSCODE);
    const assistant1 = results[1]!;
    expect(assistant1.message.role).toBe("assistant");
    expect(assistant1.message.content).toContain("JWT tokens with a middleware approach");
    // Must NOT contain the intermediate commentary
    expect(assistant1.message.content).not.toContain("I'm analyzing your project structure");
    expect(assistant1.message.content).not.toContain("Let me check the existing code");
  });

  it("emits exactly ONE assistant message when both final_answer and task_complete are present", async () => {
    const results = await collectMessages(FIXTURE_VSCODE);
    const assistantMsgs = results.filter((r) => r.message.role === "assistant");
    // 2 turns → 2 assistant messages total (not 4)
    expect(assistantMsgs).toHaveLength(2);
  });

  it("handles multi-turn correctly", async () => {
    const results = await collectMessages(FIXTURE_VSCODE);
    expect(results.map((r) => r.message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("second turn user message has no preamble", async () => {
    const results = await collectMessages(FIXTURE_VSCODE);
    const user2 = results[2]!;
    expect(user2.message.content).toBe("Can you also add OAuth?");
  });

  it("assigns turn_id as user message ID when present", async () => {
    const results = await collectMessages(FIXTURE_VSCODE);
    expect(results[0]!.message.id).toBe("turn-001");
    expect(results[2]!.message.id).toBe("turn-002");
  });

  it("sets model from first turn_context", async () => {
    const results = await collectMessages(FIXTURE_VSCODE);
    const assistant1 = results[1]!;
    expect(assistant1.message.model).toBe("gpt-5.3-codex");
  });

  it("links function_call and function_call_output by call_id", async () => {
    const results = await collectMessages(FIXTURE_VSCODE);
    const assistant1 = results[1]!;
    expect(assistant1.message.toolCalls).toHaveLength(1);
    const tc = assistant1.message.toolCalls![0]!;
    expect(tc.name).toBe("exec_command");
    expect(tc.input).toEqual({ cmd: "ls src/" });
    expect(tc.result).toContain("auth.ts");
  });

  it("maps reasoning summary to ThinkingBlock", async () => {
    const results = await collectMessages(FIXTURE_VSCODE);
    const assistant1 = results[1]!;
    expect(assistant1.message.thinkingBlocks).toHaveLength(1);
    expect(assistant1.message.thinkingBlocks![0]!.content).toContain(
      "set up authentication",
    );
  });

  it("tracks strictly increasing offsets across messages", async () => {
    const results = await collectMessages(FIXTURE_VSCODE);
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.offset).toBeGreaterThan(results[i - 1]!.offset);
    }
  });

  it("mid-turn resume: starting from after user1 yields only assistant1", async () => {
    const full = await collectMessages(FIXTURE_VSCODE);
    const user1Offset = full[0]!.offset;
    // Resume from right after user1 — should get assistant1 only (not user1 again)
    const resumed = await collectMessages(FIXTURE_VSCODE, user1Offset);
    expect(resumed[0]!.message.role).toBe("assistant");
    expect(resumed[0]!.message.content).toContain("JWT tokens");
  });

  it("resume from assistant1 offset yields turn 2 (user2 + assistant2)", async () => {
    const full = await collectMessages(FIXTURE_VSCODE);
    const assistant1Offset = full[1]!.offset;
    const resumed = await collectMessages(FIXTURE_VSCODE, assistant1Offset);
    expect(resumed).toHaveLength(2);
    expect(resumed[0]!.message.role).toBe("user");
    expect(resumed[1]!.message.role).toBe("assistant");
  });
});

// ---------------------------------------------------------------------------
// Legacy fixture (pre-0.104.0, EOF flush)
// ---------------------------------------------------------------------------

describe("parseCodexMessages — legacy fixture (CLI, no task_complete)", () => {
  it("yields user message unchanged (no preamble)", async () => {
    const results = await collectMessages(FIXTURE_LEGACY);
    const user1 = results[0]!;
    expect(user1.message.role).toBe("user");
    expect(user1.message.content).toBe("How do I use async/await in JavaScript?");
  });

  it("yields assistant message via EOF flush from last agent_message", async () => {
    const results = await collectMessages(FIXTURE_LEGACY);
    const assistant1 = results[1]!;
    expect(assistant1.message.role).toBe("assistant");
    expect(assistant1.message.content).toContain(
      "Async/await is a modern JavaScript feature",
    );
  });

  it("yields exactly 2 messages total (1 user + 1 assistant)", async () => {
    const results = await collectMessages(FIXTURE_LEGACY);
    expect(results).toHaveLength(2);
  });

  it("links function_call and function_call_output in legacy format", async () => {
    const results = await collectMessages(FIXTURE_LEGACY);
    const assistant = results[1]!;
    expect(assistant.message.toolCalls).toHaveLength(1);
    const tc = assistant.message.toolCalls![0]!;
    expect(tc.name).toBe("search");
    expect(tc.result).toContain("async/await is a syntax");
  });

  it("maps reasoning summary to ThinkingBlock in legacy format", async () => {
    const results = await collectMessages(FIXTURE_LEGACY);
    const assistant = results[1]!;
    expect(assistant.message.thinkingBlocks).toHaveLength(1);
    expect(assistant.message.thinkingBlocks![0]!.content).toContain("async/await basics");
  });

  it("does not set model when no turn_context present", async () => {
    const results = await collectMessages(FIXTURE_LEGACY);
    // Legacy fixture has no turn_context
    expect(results[1]!.message.model).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Aborted / empty turn
// ---------------------------------------------------------------------------

describe("parseCodexMessages — aborted turn", () => {
  it("yields user message but no assistant when turn_aborted fires with no content", async () => {
    // Create a temp fixture with a turn_aborted event and no agent content
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stenobot-test-"));
    const tmpFile = path.join(tmpDir, "aborted.jsonl");
    await fs.writeFile(
      tmpFile,
      [
        '{"type":"session_meta","payload":{"id":"aborted-001","source":"cli","cwd":"/tmp","cli_version":"0.104.0"}}',
        '{"type":"event_msg","payload":{"type":"user_message","message":"Start a task"}}',
        '{"type":"event_msg","payload":{"type":"turn_aborted"}}',
      ].join("\n") + "\n",
      "utf-8",
    );

    try {
      const results = await collectMessages(tmpFile);
      // User message should be yielded
      expect(results[0]!.message.role).toBe("user");
      // No assistant message — nothing to emit
      const assistantMsgs = results.filter((r) => r.message.role === "assistant");
      expect(assistantMsgs).toHaveLength(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Offset stability
// ---------------------------------------------------------------------------

describe("parseCodexMessages — offset behavior", () => {
  it("EOF-flushed assistant offset equals file size (stable across re-polls)", async () => {
    const results = await collectMessages(FIXTURE_LEGACY);
    const assistantOffset = results[1]!.offset;
    const fileSize = (await fs.stat(FIXTURE_LEGACY)).size;
    // EOF flush offset should be at or near the end of the file
    // (within 1 byte due to newline handling)
    expect(assistantOffset).toBeGreaterThanOrEqual(fileSize - 1);
  });

  it("re-parsing from EOF flush offset yields no messages (stable)", async () => {
    const results = await collectMessages(FIXTURE_LEGACY);
    const eofOffset = results[1]!.offset;
    const resumed = await collectMessages(FIXTURE_LEGACY, eofOffset);
    expect(resumed).toHaveLength(0);
  });
});
