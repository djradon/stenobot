import { buildCommand } from "@stricli/core";

export const stopCommand = buildCommand({
  loader: async () => {
    const { stopImpl } = await import("./stop.impl.js");
    return stopImpl;
  },
  parameters: {
    positional: { kind: "tuple", parameters: [] },
    flags: {},
  },
  docs: {
    brief: "Stop the stenobot monitoring daemon",
  },
});
