import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: LogLevel;
  scope: string;
  message: string;
  meta?: Record<string, unknown>;
}

type ConsoleMethod = "log" | "warn" | "error";

class AppLogger {
  private enabled = false;
  private consoleCaptureInstalled = false;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getLogDirectory(): string {
    return path.join(app.getPath("userData"), "logs");
  }

  installConsoleCapture(): void {
    if (this.consoleCaptureInstalled) {
      return;
    }
    this.consoleCaptureInstalled = true;

    const levelMap: Record<ConsoleMethod, LogLevel> = {
      log: "info",
      warn: "warn",
      error: "error",
    };

    for (const method of ["log", "warn", "error"] as ConsoleMethod[]) {
      console[method] = (...args: unknown[]) => {
        this.originalConsole[method](...args);
        if (!this.enabled) {
          return;
        }
        this.write(levelMap[method], "console", this.formatArgs(args));
      };
    }
  }

  info(scope: string, message: string, meta?: Record<string, unknown>): void {
    this.write("info", scope, message, meta);
  }

  warn(scope: string, message: string, meta?: Record<string, unknown>): void {
    this.write("warn", scope, message, meta);
  }

  error(scope: string, message: string, meta?: Record<string, unknown>): void {
    this.write("error", scope, message, meta);
  }

  private write(level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>): void {
    if (!this.enabled) {
      return;
    }

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      scope,
      message,
      meta,
    };
    const line = `${JSON.stringify(entry)}\n`;

    this.writeChain = this.writeChain
      .then(async () => {
        const logDirectory = this.getLogDirectory();
        await fs.promises.mkdir(logDirectory, { recursive: true });
        const logPath = path.join(logDirectory, `${entry.ts.slice(0, 10)}.log`);
        await fs.promises.appendFile(logPath, line, "utf8");
      })
      .catch((error) => {
        this.originalConsole.error("[AppLogger] Failed to write log:", error);
      });
  }

  private formatArgs(args: unknown[]): string {
    return args.map((arg) => this.stringify(arg)).join(" ");
  }

  private stringify(value: unknown): string {
    if (value instanceof Error) {
      return value.stack || value.message;
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
      return String(value);
    }
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return Object.prototype.toString.call(value);
    }
  }
}

const appLogger = new AppLogger();

export default appLogger;
