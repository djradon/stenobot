import { buildCommand } from "@stricli/core";

export const exportCommand = buildCommand({
  loader: async () => {
    const { exportImpl } = await import("./export.impl.js");
    return exportImpl;
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Session ID or path to session JSONL file",
          parse: String,
          placeholder: "session-id",
        },
      ],
    },
    flags: {
      output: {
        kind: "parsed",
        brief: "Output file path",
        parse: String,
        optional: true,
      },
      thinking: {
        kind: "boolean",
        brief: "Include thinking/reasoning blocks in output",
        optional: true,
      },
      toolCalls: {
        kind: "boolean",
        brief: "Include tool calls in output",
        optional: true,
      },
      italics: {
        kind: "boolean",
        brief: "Italicize user messages",
        optional: true,
      },
    },
  },
  docs: {
    brief: "Export a session to markdown",
  },
});
