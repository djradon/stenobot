import { buildCommand } from "@stricli/core";

export const startCommand = buildCommand({
  loader: async () => {
    const { startImpl } = await import("./start.impl.js");
    return startImpl;
  },
  parameters: {
    positional: { kind: "tuple", parameters: [] },
    flags: {},
  },
  docs: {
    brief: "Start the stenobot monitoring daemon",
  },
});
