import fs from "node:fs/promises";
import path from "node:path";
import winston from "winston";

const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.simple(),
  ),
});

export const logger = winston.createLogger({
  level: process.env["STENOBOT_LOG_LEVEL"] ?? "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: "stenobot" },
  transports: [consoleTransport],
});

interface LoggerConfig {
  logFile?: string;
  includeConsole?: boolean;
}

/**
 * Reconfigure logger transports at runtime.
 * Used by daemon mode to route logs to the configured file path.
 */
export async function configureLogger({
  logFile,
  includeConsole = true,
}: LoggerConfig = {}): Promise<void> {
  logger.clear();

  if (includeConsole) {
    logger.add(consoleTransport);
  }

  if (!logFile) return;

  await fs.mkdir(path.dirname(logFile), { recursive: true });
  logger.add(
    new winston.transports.File({
      filename: logFile,
      tailable: true,
    }),
  );
}
