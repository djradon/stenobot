import { buildCommand } from "@stricli/core";

export const initCommand = buildCommand({
  loader: async () => {
    const { initImpl } = await import("./init.impl.js");
    return initImpl;
  },
  parameters: {
    flags: {
      force: {
        kind: "boolean",
        brief: "Overwrite existing config file",
        optional: true,
      },
    },
  },
  docs: {
    brief: "Generate a default config file at ~/.stenobot/config.yaml",
    fullDescription: [
      "Creates ~/.stenobot/config.yaml with all settings at their defaults.",
      "The file includes comments explaining each setting and its possible values.",
      "",
      "If the config file already exists, this command does nothing unless --force is passed.",
      "",
      "Examples:",
      "  stenobot init              # Create config if it doesn't exist",
      "  stenobot init --force      # Overwrite existing config with defaults",
    ].join("\n"),
  },
});
