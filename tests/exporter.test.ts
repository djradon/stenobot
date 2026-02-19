import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exportToMarkdown, formatMessage, renderToString } from "../src/core/exporter.js";
import type { ExportOptions } from "../src/core/exporter.js";
import type { Message } from "../src/types/index.js";
import { formatInTimeZone } from "date-fns-tz";

/** Format an ISO timestamp into the heading timestamp part using local timezone */
function localHeading(iso: string): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return formatInTimeZone(new Date(iso), tz, "yyyy-MM-dd_HHmm_ss");
}

const baseOptions: ExportOptions = {
  metadata: {
    includeTimestamps: true,
    includeToolCalls: false,
    includeThinking: false,
    italicizeUserMessages: true,
    truncateToolResults: 1000,
  },
};

function makeUserMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-u1",
    role: "user",
    content: "Hello, can you help?",
    timestamp: "2026-02-10T23:36:18.000Z",
    ...overrides,
  };
}

function makeAssistantMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-a1",
    role: "assistant",
    content: "Of course! I'd be happy to help.",
    timestamp: "2026-02-10T23:36:25.000Z",
    model: "claude-opus-4-6",
    ...overrides,
  };
}

describe("formatMessage", () => {
  it("formats user message with italics and User heading", () => {
    const result = formatMessage(makeUserMessage(), baseOptions);
    expect(result).toContain(`# User_${localHeading("2026-02-10T23:36:18.000Z")}`);
    expect(result).toContain("*Hello, can you help?*");
  });

  it("uses model name in assistant heading when available", () => {
    const result = formatMessage(makeAssistantMessage(), baseOptions);
    expect(result).toContain(`# claude-opus-4.6_${localHeading("2026-02-10T23:36:25.000Z")}`);
    expect(result).toContain("Of course! I'd be happy to help.");
    // Content should NOT be italicized
    expect(result).not.toMatch(/\*Of course/);
  });

  it("falls back to speaker name when model is missing", () => {
    const msg = makeAssistantMessage({ model: undefined });
    const result = formatMessage(msg, baseOptions);
    expect(result).toContain(`# Claude_${localHeading("2026-02-10T23:36:25.000Z")}`);
  });

  it("uses custom speaker names", () => {
    const opts: ExportOptions = {
      ...baseOptions,
      speakerNames: { user: "Dave", assistant: "AI" },
    };
    const userResult = formatMessage(makeUserMessage(), opts);
    expect(userResult).toContain(`# Dave_${localHeading("2026-02-10T23:36:18.000Z")}`);

    // Custom assistant name is overridden by model when model is present
    const assistantResult = formatMessage(makeAssistantMessage(), opts);
    expect(assistantResult).toContain("# claude-opus-4.6_");

    // Without model, custom name takes effect
    const noModelResult = formatMessage(
      makeAssistantMessage({ model: undefined }),
      opts,
    );
    expect(noModelResult).toContain(`# AI_${localHeading("2026-02-10T23:36:25.000Z")}`);
  });

  it("escapes asterisks in user messages", () => {
    const msg = makeUserMessage({ content: "Use *bold* here" });
    const result = formatMessage(msg, baseOptions);
    expect(result).toContain("*Use \\*bold\\* here*");
  });

  it("handles empty lines in user messages", () => {
    const msg = makeUserMessage({ content: "Line one\n\nLine three" });
    const result = formatMessage(msg, baseOptions);
    expect(result).toContain("*Line one*\n\n*Line three*");
  });

  it("renders tool calls when includeToolCalls is true", () => {
    const msg = makeAssistantMessage({
      toolCalls: [
        {
          id: "toolu_1",
          name: "Read",
          description: "/src/index.ts",
          result: "const x = 1;",
        },
      ],
    });
    const opts: ExportOptions = {
      ...baseOptions,
      metadata: { ...baseOptions.metadata, includeToolCalls: true },
    };
    const result = formatMessage(msg, opts);
    expect(result).toContain("<details>");
    expect(result).toContain("<summary>Tool Calls</summary>");
    expect(result).toContain("**Read**: /src/index.ts");
    expect(result).toContain("const x = 1;");
  });

  it("hides tool calls when includeToolCalls is false", () => {
    const msg = makeAssistantMessage({
      toolCalls: [
        { id: "toolu_1", name: "Read", description: "/src/index.ts" },
      ],
    });
    const result = formatMessage(msg, baseOptions);
    expect(result).not.toContain("Tool Calls");
    expect(result).not.toContain("<details>");
  });

  it("truncates long tool results", () => {
    const longResult = "x".repeat(200);
    const msg = makeAssistantMessage({
      toolCalls: [
        { id: "toolu_1", name: "Bash", result: longResult },
      ],
    });
    const opts: ExportOptions = {
      ...baseOptions,
      metadata: {
        ...baseOptions.metadata,
        includeToolCalls: true,
        truncateToolResults: 50,
      },
    };
    const result = formatMessage(msg, opts);
    expect(result).toContain("x".repeat(50) + "...");
    expect(result).not.toContain("x".repeat(200));
  });

  it("renders thinking blocks when includeThinking is true", () => {
    const msg = makeAssistantMessage({
      thinkingBlocks: [{ content: "Let me reason about this..." }],
    });
    const opts: ExportOptions = {
      ...baseOptions,
      metadata: { ...baseOptions.metadata, includeThinking: true },
    };
    const result = formatMessage(msg, opts);
    expect(result).toContain("<summary>Thinking</summary>");
    expect(result).toContain("Let me reason about this...");
  });

  it("hides thinking blocks when includeThinking is false", () => {
    const msg = makeAssistantMessage({
      thinkingBlocks: [{ content: "secret reasoning" }],
    });
    const result = formatMessage(msg, baseOptions);
    expect(result).not.toContain("Thinking");
    expect(result).not.toContain("secret reasoning");
  });
});

describe("renderToString", () => {
  it("includes Dendron frontmatter by default", () => {
    const result = renderToString([makeUserMessage()], {
      ...baseOptions,
      title: "Test Conversation",
    });
    expect(result).toMatch(/^---\n/);
    expect(result).toContain("title: Test Conversation");
    expect(result).toMatch(/id: [\w-]+/);
    expect(result).toMatch(/created: \d+/);
    expect(result).toMatch(/updated: \d+/);
    expect(result).toContain("---");
  });

  it("omits frontmatter when includeFrontmatter is false", () => {
    const result = renderToString([makeUserMessage()], {
      ...baseOptions,
      includeFrontmatter: false,
    });
    expect(result).not.toMatch(/^---/);
    expect(result).toContain("# User_");
  });

  it("renders multiple messages in order", () => {
    const messages = [makeUserMessage(), makeAssistantMessage()];
    const result = renderToString(messages, {
      ...baseOptions,
      includeFrontmatter: false,
    });
    const userIdx = result.indexOf("# User_");
    const assistantIdx = result.indexOf("# claude-opus-4.6_");
    expect(userIdx).toBeLessThan(assistantIdx);
  });
});

describe("exportToMarkdown", () => {
  it("does not append the same rendered block twice", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stenobot-exporter-test-"));
    const outputPath = path.join(tmpDir, "dedupe.md");

    try {
      const message = makeAssistantMessage();
      await exportToMarkdown([message], outputPath, baseOptions);
      await exportToMarkdown([message], outputPath, baseOptions);

      const content = await fs.readFile(outputPath, "utf-8");
      const heading = `# claude-opus-4.6_${localHeading(message.timestamp)}`;
      const headingCount = content.split(heading).length - 1;
      expect(headingCount).toBe(1);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("skips append when a batch has no visible content", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stenobot-exporter-test-"));
    const outputPath = path.join(tmpDir, "no-blank-lines.md");

    try {
      await exportToMarkdown([makeUserMessage()], outputPath, baseOptions);
      const before = await fs.readFile(outputPath, "utf-8");

      const invisibleAssistant = makeAssistantMessage({
        id: "msg-a2",
        content: "",
        toolCalls: [{ id: "toolu_2", name: "Read" }],
      });
      await exportToMarkdown([invisibleAssistant], outputPath, baseOptions);

      const after = await fs.readFile(outputPath, "utf-8");
      expect(after).toBe(before);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
