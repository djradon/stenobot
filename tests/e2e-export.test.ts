import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseClaudeMessages } from "../src/providers/claude-code/parser.js";
import { exportToMarkdown } from "../src/core/exporter.js";
import type { Message } from "../src/types/index.js";
import { formatInTimeZone } from "date-fns-tz";

/** Format an ISO timestamp into the heading timestamp part using local timezone */
function localHeading(iso: string): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return formatInTimeZone(new Date(iso), tz, "yyyy-MM-dd_HHmm_ss");
}

const FIXTURE = path.join(import.meta.dirname, "fixtures", "claude-session.jsonl");

describe("end-to-end export", () => {
  it("parses a JSONL fixture and exports correct markdown", async () => {
    // Phase 1: Parse
    const messages: Message[] = [];
    for await (const { message } of parseClaudeMessages(FIXTURE)) {
      messages.push(message);
    }
    expect(messages).toHaveLength(4);

    // Phase 2: Export to temp file
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clogger-test-"));
    const outputPath = path.join(tmpDir, "test-export.md");

    try {
      await exportToMarkdown(messages, outputPath, {
        title: "Auth Discussion",
        metadata: {
          includeTimestamps: true,
          includeToolCalls: true,
          includeThinking: true,
          italicizeUserMessages: true,
          truncateToolResults: 500,
        },
        speakerNames: { user: "Dave" },
      });

      // Phase 3: Verify output
      const content = await fs.readFile(outputPath, "utf-8");

      // Frontmatter
      expect(content).toMatch(/^---\n/);
      expect(content).toContain("title: Auth Discussion");
      expect(content).toMatch(/id: \w+/);

      // User message — italicized with custom name
      expect(content).toContain(`# Dave_${localHeading("2026-02-10T23:36:18.000Z")}`);
      expect(content).toContain(
        "*I want to add authentication to my app. Can you help?*",
      );

      // Assistant message — uses model name
      expect(content).toContain(`# claude-opus-4.6_${localHeading("2026-02-10T23:36:25.000Z")}`);

      // Thinking block in details
      expect(content).toContain("<summary>Thinking</summary>");
      expect(content).toContain(
        "The user wants auth. Let me check what framework they're using.",
      );

      // Tool calls in details
      expect(content).toContain("<summary>Tool Calls</summary>");
      expect(content).toContain("**Read**: /home/user/project/package.json");
      expect(content).toContain('"name": "my-app"'); // tool result
      expect(content).toContain("**Grep**: auth|login|session");
      expect(content).toContain("No matches found.");

      // Second exchange
      expect(content).toContain(`# Dave_${localHeading("2026-02-10T23:40:12.000Z")}`);
      expect(content).toContain(
        "*Sounds good, let's go with Passport.js. Can you set it up?*",
      );
      expect(content).toContain(
        "I'll set up Passport.js with JWT authentication",
      );

      // Should not contain sidechain content
      expect(content).not.toContain("sidechain message");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("appends to an existing file without adding frontmatter", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clogger-test-"));
    const outputPath = path.join(tmpDir, "existing.md");

    try {
      // Pre-create the file with Dendron frontmatter (user's workflow)
      const existingContent = `---
id: pre-existing-id
title: My Conversation
desc: ''
created: 1770799535662
updated: 1770799535662
---

`;
      await fs.writeFile(outputPath, existingContent, "utf-8");

      // Export messages
      const messages: Message[] = [];
      for await (const { message } of parseClaudeMessages(FIXTURE)) {
        messages.push(message);
      }

      await exportToMarkdown(messages, outputPath, {
        metadata: {
          includeTimestamps: true,
          includeToolCalls: false,
          includeThinking: false,
          italicizeUserMessages: true,
          truncateToolResults: 1000,
        },
      });

      const content = await fs.readFile(outputPath, "utf-8");

      // Original frontmatter preserved, no second frontmatter block
      expect(content).toContain("id: pre-existing-id");
      expect(content).toContain("title: My Conversation");

      // Count frontmatter delimiters — should only have the original pair
      const delimiterCount = (content.match(/^---$/gm) ?? []).length;
      expect(delimiterCount).toBe(2);

      // Messages appended
      expect(content).toContain(`# User_${localHeading("2026-02-10T23:36:18.000Z")}`);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
