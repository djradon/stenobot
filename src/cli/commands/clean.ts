import { buildCommand } from "@stricli/core";

export const cleanCommand = buildCommand({
  loader: async () => {
    const { cleanImpl } = await import("./clean.impl.js");
    return cleanImpl;
  },
  parameters: {
    flags: {
      recordings: {
        kind: "parsed",
        brief: "Remove recordings older than N days",
        parse: Number,
        optional: true,
        placeholder: "days",
      },
      sessions: {
        kind: "parsed",
        brief: "Remove tracked sessions older than N days",
        parse: Number,
        optional: true,
        placeholder: "days",
      },
      all: {
        kind: "boolean",
        brief: "Remove all recordings and sessions",
        optional: true,
      },
      dryRun: {
        kind: "boolean",
        brief: "Preview what would be cleaned without actually removing anything",
        optional: true,
      },
    },
  },
  docs: {
    brief: "Clean up stale recordings and session state",
    fullDescription: [
      "Remove old recordings and tracked sessions from stenobot state.",
      "",
      "Examples:",
      "  stenobot clean --recordings 7     # Remove recordings older than 7 days",
      "  stenobot clean --sessions 30      # Remove sessions older than 30 days",
      "  stenobot clean --all              # Remove all recordings and sessions",
      "  stenobot clean --all --dryRun     # Preview what would be removed",
    ].join("\n"),
  },
});
