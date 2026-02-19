import { describe, it, expect } from "vitest";
import { detectCommand, detectAllCommands } from "../src/core/detector.js";

describe("detectCommand", () => {
  it("detects ::record command with filename", () => {
    const result = detectCommand("::record my-conversation.md");
    expect(result).toEqual({
      name: "record",
      args: "my-conversation.md",
      rawMessage: "::record my-conversation.md",
    });
  });

  it("detects ::record command with @-mention path", () => {
    const result = detectCommand("::record @private-notes/conv.design.md");
    expect(result).toEqual({
      name: "record",
      args: "@private-notes/conv.design.md",
      rawMessage: "::record @private-notes/conv.design.md",
    });
  });

  it("detects ::stop command", () => {
    const result = detectCommand("::stop");
    expect(result).toEqual({
      name: "stop",
      args: "",
      rawMessage: "::stop",
    });
  });

  it("detects ::capture command with args", () => {
    const result = detectCommand("::capture ~/notes/conv.md");
    expect(result).toEqual({
      name: "capture",
      args: "~/notes/conv.md",
      rawMessage: "::capture ~/notes/conv.md",
    });
  });

  it("is case-insensitive", () => {
    const result = detectCommand("::RECORD test.md");
    expect(result).toEqual({
      name: "record",
      args: "test.md",
      rawMessage: "::RECORD test.md",
    });
  });

  it("detects ::export command with filename", () => {
    const result = detectCommand("::export my-session.md");
    expect(result).toEqual({
      name: "export",
      args: "my-session.md",
      rawMessage: "::export my-session.md",
    });
  });

  it("detects ::capture command with filename", () => {
    const result = detectCommand("::capture project-log.md");
    expect(result).toEqual({
      name: "capture",
      args: "project-log.md",
      rawMessage: "::capture project-log.md",
    });
  });

  it("returns null for non-command messages", () => {
    expect(detectCommand("hello world")).toBeNull();
    expect(detectCommand("let's discuss the :: syntax")).toBeNull();
    expect(detectCommand("")).toBeNull();
  });

  it("returns null for unrecognized commands", () => {
    expect(detectCommand("::foobar")).toBeNull();
    expect(detectCommand("::summarize output.md")).toBeNull();
  });

  it("detects command on first line when multiple commands present", () => {
    const result = detectCommand("::record test.md\nsome other text\n::stop");
    expect(result?.name).toBe("record");
  });

  it("detects commands that don't start at beginning of line", () => {
    const result = detectCommand("We will ::record @path/to/file.md");
    expect(result).toEqual({
      name: "record",
      args: "@path/to/file.md",
      rawMessage: "We will ::record @path/to/file.md",
    });
  });

  it("extracts path from natural language with @-mention", () => {
    const result = detectCommand("Let's ::record this into @notes/conv.md for later");
    expect(result?.name).toBe("record");
    expect(result?.args).toContain("@notes/conv.md");
  });

  it("extracts full path from <ide_opened_file> tag when present", () => {
    const message = `::capture @sflo/documentation/file.md

<ide_opened_file>The user opened the file /home/djradon/hub/semantic-flow/sflo/documentation/file.md in the IDE.</ide_opened_file>`;

    const result = detectCommand(message);
    expect(result).toEqual({
      name: "capture",
      args: "/home/djradon/hub/semantic-flow/sflo/documentation/file.md",
      rawMessage: message,
    });
  });

  it("falls back to visible path when <ide_opened_file> contains non-markdown file", () => {
    const message = `::record @notes/conv.md

<ide_opened_file>The user opened the file /home/user/project/README.txt in the IDE.</ide_opened_file>`;

    const result = detectCommand(message);
    expect(result?.name).toBe("record");
    expect(result?.args).toBe("@notes/conv.md");
  });

  it("detects command on any line, not just first", () => {
    const message = `Some text before the command

::capture @notes/session.md

More text after`;

    const result = detectCommand(message);
    expect(result?.name).toBe("capture");
    expect(result?.args).toContain("@notes/session.md");
  });

  it("matches @-mentioned path with correct <ide_opened_file> tag when multiple tags present", () => {
    const message = `<ide_opened_file>The user opened the file /home/user/project/other-file.md in the IDE.</ide_opened_file>

::record @sflo/documentation/conv.md

<ide_opened_file>The user opened the file /home/djradon/hub/semantic-flow/sflo/documentation/conv.md in the IDE.</ide_opened_file>

<ide_opened_file>The user opened the file /home/user/notes/unrelated.md in the IDE.</ide_opened_file>`;

    const result = detectCommand(message);
    expect(result).toEqual({
      name: "record",
      args: "/home/djradon/hub/semantic-flow/sflo/documentation/conv.md",
      rawMessage: message,
    });
  });

  it("returns visible path when no <ide_opened_file> tag matches the @-mention", () => {
    const message = `<ide_opened_file>The user opened the file /home/user/other/file.md in the IDE.</ide_opened_file>

::capture @notes/session.md`;

    const result = detectCommand(message);
    expect(result?.name).toBe("capture");
    expect(result?.args).toBe("@notes/session.md");
  });

  // --- stricter parsing ---

  it("signals auto-generate when file command has no args (args = '')", () => {
    expect(detectCommand("::capture")).toEqual({
      name: "capture",
      args: "",
      rawMessage: "::capture",
    });
    expect(detectCommand("::record")).toEqual({
      name: "record",
      args: "",
      rawMessage: "::record",
    });
    expect(detectCommand("::export")).toEqual({
      name: "export",
      args: "",
      rawMessage: "::export",
    });
  });

  it("strips leading 'to' bridge word before the path", () => {
    expect(detectCommand("::record to notes.md")?.args).toBe("notes.md");
    expect(detectCommand("::capture to @notes/conv.md")?.args).toBe("@notes/conv.md");
    expect(detectCommand("::capture TO ~/docs/log.md")?.args).toBe("~/docs/log.md");
  });

  it("extracts @-mention path preceded by natural language including 'to'", () => {
    const result = detectCommand(
      "I'm going to ::capture this conversation to @documentation/notes/conv.md"
    );
    expect(result?.name).toBe("capture");
    expect(result?.args).toBe("@documentation/notes/conv.md");
  });

  it("ignores file commands in backtick code spans", () => {
    expect(detectCommand("`::capture notes.md`")).toBeNull();
    expect(detectCommand("use `::record file.md` to start")).toBeNull();
  });

  it("ignores file commands embedded in prose without a recognisable path", () => {
    expect(detectCommand("the docs discuss ::capture in detail")).toBeNull();
    expect(detectCommand("use ::record to log this conversation")).toBeNull();
    expect(detectCommand("::capture but the explanatory text")).toBeNull();
  });

  it("extracts quoted path that contains spaces", () => {
    expect(detectCommand('::capture "my notes/session.md"')?.args).toBe("my notes/session.md");
    expect(detectCommand("::record 'docs/my session.md'")?.args).toBe("docs/my session.md");
  });

  it("accepts filename without .md extension (extension added later)", () => {
    expect(detectCommand("::record my-session")?.args).toBe("my-session");
    expect(detectCommand("::capture notes/todays-log")?.args).toBe("notes/todays-log");
  });

  it("accepts Windows absolute paths", () => {
    expect(detectCommand("::record C:\\Users\\notes\\file.md")?.args).toBe(
      "C:\\Users\\notes\\file.md"
    );
    expect(detectCommand("::capture \\\\server\\share\\file.md")?.args).toBe(
      "\\\\server\\share\\file.md"
    );
  });
});

describe("detectAllCommands", () => {
  it("detects multiple commands in a single message", () => {
    const message = `::stop

::capture @notes/session.md`;

    const results = detectAllCommands(message);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      name: "stop",
      args: "",
      rawMessage: message,
    });
    expect(results[1]).toEqual({
      name: "capture",
      args: "@notes/session.md",
      rawMessage: message,
    });
  });

  it("detects multiple commands with natural language between them", () => {
    const message = `::stop and then

::capture @path/to/file.md

Let's record this.`;

    const results = detectAllCommands(message);
    expect(results).toHaveLength(2);
    expect(results[0]?.name).toBe("stop");
    expect(results[1]?.name).toBe("capture");
  });

  it("returns empty array when no commands found", () => {
    const results = detectAllCommands("just some text");
    expect(results).toEqual([]);
  });

  it("skips prose-only file commands and still detects valid ones", () => {
    const message = `Use ::capture to start recording, then later:

::capture @notes/session.md`;

    const results = detectAllCommands(message);
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("capture");
    expect(results[0]?.args).toBe("@notes/session.md");
  });

  it("does not detect backtick-wrapped commands", () => {
    const message = "Run `::capture notes.md` to begin.\n\n::stop";
    const results = detectAllCommands(message);
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("stop");
  });
});
