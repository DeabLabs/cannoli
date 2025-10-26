import { log } from "@clack/prompts";
import { argumentsConfig } from "src/arguments";

declare global {
  // eslint-disable-next-line no-var
  var logger: Logger | undefined;
}

type LoggerLevel = "info" | "warn" | "error" | "debug";

export type Logger = {
  getLevel: () => LoggerLevel;
  setLevel: (level: LoggerLevel) => void;
  success: (message: string, ...rest: string[]) => void;
  log: (message: string, ...rest: string[]) => void;
  warn: (message: string, ...rest: string[]) => void;
  error: (message: string, ...rest: string[]) => void;
  debug: (message: string, ...rest: string[]) => void;
};

function ensureLogger(level: LoggerLevel): Logger {
  if (!globalThis.logger) {
    globalThis.logger = new ClackLogger(level);
  }
  return globalThis.logger;
}

export const getLogger = (
  level: LoggerLevel = argumentsConfig.verbose ? "debug" : "info",
): Logger => ensureLogger(level);

export class ClackLogger implements Logger {
  private level: LoggerLevel;

  constructor(level: LoggerLevel) {
    this.level = level;
  }

  getLevel(): LoggerLevel {
    return this.level;
  }

  setLevel(level: LoggerLevel): void {
    this.level = level;
  }

  private shouldLog(level: LoggerLevel): boolean {
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    return levels[level] <= levels[this.level];
  }

  private concatenateMessages(message: string, ...rest: string[]): string {
    if (rest.length === 0) {
      return message;
    }
    return `${message} ${rest.join(" ")}`;
  }

  log = (message: string, ...rest: string[]): void => {
    if (this.shouldLog("info")) {
      log.info(this.concatenateMessages(message, ...rest));
    }
  };

  success = (message: string, ...rest: string[]): void => {
    if (this.shouldLog("info")) {
      log.success(this.concatenateMessages(message, ...rest));
    }
  };

  warn = (message: string, ...rest: string[]): void => {
    if (this.shouldLog("warn")) {
      log.warn(this.concatenateMessages(message, ...rest));
    }
  };

  error = (message: string, ...rest: string[]): void => {
    if (this.shouldLog("error")) {
      log.error(this.concatenateMessages(message, ...rest));
    }
  };

  debug = (message: string, ...rest: string[]): void => {
    if (this.shouldLog("debug")) {
      // Clack doesn't have a debug method, use info with a prefix
      log.info(`[DEBUG] ${this.concatenateMessages(message, ...rest)}`);
    }
  };
}
