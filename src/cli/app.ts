import { buildApplication, buildRouteMap } from "@stricli/core";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { statusCommand } from "./commands/status.js";
import { exportCommand } from "./commands/export.js";
import { cleanCommand } from "./commands/clean.js";
import { initCommand } from "./commands/init.js";
import pkg from "../../package.json" with { type: "json" };

const routes = buildRouteMap({
  routes: {
    init: initCommand,
    start: startCommand,
    stop: stopCommand,
    status: statusCommand,
    export: exportCommand,
    clean: cleanCommand,
  },
  docs: {
    brief: "Chat logger — monitor and export LLM conversation logs to markdown",
  },
});

export const app = buildApplication(routes, {
  name: "stenobot",
  versionInfo: {
    currentVersion: pkg.version,
  },
});
