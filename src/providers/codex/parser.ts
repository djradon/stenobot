import fsSync from "node:fs";
import readline from "node:readline";
import type { Message, ToolCall, ThinkingBlock } from "../../types/index.js";
import { normalizeText } from "../../utils/text.js";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CodexEntry {
  type: string;
  payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip the VSCode IDE preamble from a user message.
 * Extracts everything after "## My request for Codex:\n" if present,
 * otherwise returns the full text.
 */
function stripIdePreamble(text: string): string {
  const marker = "## My request for Codex:\n";
  const idx = text.indexOf(marker);
  if (idx >= 0) {
    return text.slice(idx + marker.length).trim();
  }
  return text.trim();
}

/** Derive a human-readable description from a Codex tool name + input */
function deriveCodexToolDescription(
  name: string,
  input?: Record<string, unknown>,
): string | undefined {
  if (!input) return undefined;
  if (name === "exec_command" || name === "exec") {
    return typeof input["cmd"] === "string" ? input["cmd"] : undefined;
  }
  if (name === "search") {
    return typeof input["query"] === "string" ? input["query"] : undefined;
  }
  // Fall back to first string value
  for (const v of Object.values(input)) {
    if (typeof v === "string") return v;
  }
  return undefined;
}

/** Extract text from a final_answer message content array */
function extractFinalAnswerText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as Array<Record<string, unknown>>)
    .filter((b) => b["type"] === "text")
    .map((b) => String(b["text"] ?? ""))
    .join("\n\n")
    .trim();
}

function makeMessage(
  role: "user" | "assistant",
  id: string,
  model: string | undefined,
  content: string,
  toolCalls: ToolCall[],
  thinkingBlocks: ThinkingBlock[],
): Message {
  return {
    id,
    role,
    content: normalizeText(content),
    timestamp: new Date().toISOString(),
    ...(model && role === "assistant" && { model }),
    ...(toolCalls.length > 0 && { toolCalls: [...toolCalls] }),
    ...(thinkingBlocks.length > 0 && { thinkingBlocks: [...thinkingBlocks] }),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a Codex JSONL session file into normalized messages.
 *
 * User messages are yielded immediately at their own byte offset so that
 * in-chat command detection (::record, ::capture) fires without waiting for
 * the assistant response.
 *
 * Assistant messages are yielded only when finalized:
 *   1. `response_item` with `phase: "final_answer"` (preferred)
 *   2. `event_msg task_complete` → `last_agent_message` (same text, deduped)
 *   3. EOF flush of last buffered `agent_message` (legacy / aborted fallback)
 */
export async function* parseCodexMessages(
  filePath: string,
  fromOffset: number = 0,
): AsyncIterable<{ message: Message; offset: number }> {
  // ---- Persistent state (rebuilt from scratch each poll) ----
  let model: string | undefined;
  let sessionId: string | undefined;
  let currentTurnId: string | undefined;

  // Track the lineEnd of the most recent user_message (determines EOF flush eligibility)
  let userMsgEnd = -1;

  // Pending assistant buffer: holds the last seen agent_message for the current turn
  let pendingAssistantText: string | undefined;
  let toolCalls: ToolCall[] = [];
  let thinkingBlocks: ThinkingBlock[] = [];
  const pendingTools = new Map<string, ToolCall>();
  let turnFinalized = false;

  let currentByteOffset = 0;

  // ---- Helper: finalize the current turn (yield or mark already-yielded) ----
  function* finalizeAssistant(
    text: string,
    lineEnd: number,
  ): Generator<{ message: Message; offset: number }> {
    if (turnFinalized) return;
    turnFinalized = true;
    pendingAssistantText = undefined;

    if (lineEnd > fromOffset) {
      const assistantId = `${sessionId ?? "unknown"}-assist-${lineEnd}`;
      yield {
        message: makeMessage("assistant", assistantId, model, text, toolCalls, thinkingBlocks),
        offset: lineEnd,
      };
    }
    // Always clear accumulated turn data after finalization
    toolCalls = [];
    thinkingBlocks = [];
    pendingTools.clear();
  }

  // ---- Helper: flush pending assistant before a new user message ----
  function* flushPendingAssistant(
    newUserLineStart: number,
  ): Generator<{ message: Message; offset: number }> {
    // Only flush if:
    // - there's a pending assistant
    // - the turn hasn't been finalized
    // - the current turn's user message was started in this poll (userMsgEnd >= fromOffset)
    if (!pendingAssistantText || turnFinalized || userMsgEnd < fromOffset) return;
    const text = pendingAssistantText;
    turnFinalized = true;
    pendingAssistantText = undefined;
    const assistantId = `${sessionId ?? "unknown"}-assist-${newUserLineStart}`;
    yield {
      message: makeMessage("assistant", assistantId, model, text, toolCalls, thinkingBlocks),
      offset: newUserLineStart,
    };
    toolCalls = [];
    thinkingBlocks = [];
    pendingTools.clear();
  }

  // ---- Stream the file line by line ----
  const stream = fsSync.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      const lineBytes = Buffer.byteLength(line, "utf-8") + 1; // +1 for newline
      const lineStart = currentByteOffset;
      const lineEnd = lineStart + lineBytes;
      currentByteOffset = lineEnd;

      if (!line.trim()) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      const entry = parsed as CodexEntry;
      const payload = entry.payload;

      switch (entry.type) {
        case "session_meta": {
          if (payload?.["id"]) sessionId = String(payload["id"]);
          break;
        }

        case "turn_context": {
          if (!model && payload?.["model"]) model = String(payload["model"]);
          break;
        }

        case "event_msg": {
          if (!payload) break;
          const msgType = String(payload["type"] ?? "");

          if (msgType === "task_started") {
            if (payload["turn_id"]) currentTurnId = String(payload["turn_id"]);
          } else if (msgType === "user_message") {
            const rawText = String(payload["message"] ?? "");
            const text = normalizeText(stripIdePreamble(rawText));

            if (lineEnd > fromOffset) {
              // New content — flush any pending unfinalized assistant from previous turn
              yield* flushPendingAssistant(lineStart);

              // Reset turn state
              pendingAssistantText = undefined;
              toolCalls = [];
              thinkingBlocks = [];
              pendingTools.clear();
              turnFinalized = false;

              const msgId = currentTurnId ?? `${sessionId ?? "unknown"}-${lineStart}`;
              currentTurnId = undefined;
              userMsgEnd = lineEnd;

              if (text) {
                yield {
                  message: makeMessage("user", msgId, undefined, text, [], []),
                  offset: lineEnd,
                };
              }
            } else {
              // Already processed in a previous poll — rebuild turn state without yielding
              pendingAssistantText = undefined;
              toolCalls = [];
              thinkingBlocks = [];
              pendingTools.clear();
              turnFinalized = false;
              currentTurnId = undefined;
              userMsgEnd = lineEnd;
            }
          } else if (msgType === "agent_message") {
            if (!turnFinalized) {
              pendingAssistantText = String(payload["message"] ?? "");
            }
          } else if (msgType === "task_complete") {
            if (!turnFinalized) {
              const lastMsg = payload["last_agent_message"];
              const text = typeof lastMsg === "string" ? lastMsg : "";
              if (text) {
                yield* finalizeAssistant(text, lineEnd);
              }
            }
          }
          break;
        }

        case "response_item": {
          if (!payload) break;
          const itemType = String(payload["type"] ?? "");

          if (itemType === "message" && payload["phase"] === "final_answer") {
            if (!turnFinalized) {
              const text = extractFinalAnswerText(payload["content"]);
              if (text) {
                yield* finalizeAssistant(text, lineEnd);
              }
            }
          } else if (itemType === "function_call") {
            const callId = String(payload["call_id"] ?? "");
            const name = String(payload["name"] ?? "unknown");
            let input: Record<string, unknown> | undefined;
            try {
              const args = payload["arguments"];
              if (typeof args === "string") {
                input = JSON.parse(args) as Record<string, unknown>;
              }
            } catch { /* malformed JSON arguments — proceed without input */ }

            const tc: ToolCall = {
              id: callId,
              name,
              description: deriveCodexToolDescription(name, input),
              input,
            };
            toolCalls.push(tc);
            if (callId) pendingTools.set(callId, tc);
          } else if (itemType === "function_call_output") {
            const callId = String(payload["call_id"] ?? "");
            const tc = pendingTools.get(callId);
            if (tc) {
              const output = payload["output"];
              tc.result = typeof output === "string" ? output : JSON.stringify(output);
              pendingTools.delete(callId);
            }
          } else if (itemType === "reasoning") {
            const summary = payload["summary"];
            if (Array.isArray(summary) && summary.length > 0) {
              const texts = (summary as Array<Record<string, unknown>>)
                .filter((s) => s["type"] === "summary_text")
                .map((s) => String(s["text"] ?? ""))
                .filter((t) => t.length > 0);
              if (texts.length > 0) {
                thinkingBlocks.push({ content: texts.join("\n") });
              }
            }
          }
          break;
        }
      }
    }
  } finally {
    rl.close();
  }

  // EOF flush: emit buffered agent_message if the turn is still unfinalized
  // and the current turn's user message was seen in this poll (userMsgEnd >= fromOffset)
  if (pendingAssistantText && !turnFinalized && userMsgEnd >= fromOffset) {
    const assistantId = `${sessionId ?? "unknown"}-assist-${currentByteOffset}`;
    yield {
      message: makeMessage(
        "assistant",
        assistantId,
        model,
        pendingAssistantText,
        toolCalls,
        thinkingBlocks,
      ),
      offset: currentByteOffset,
    };
  }
}
