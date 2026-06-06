type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

class Logger {
  private static verbose = false;

  static setVerbose(enabled: boolean): void {
    Logger.verbose = enabled;
  }

  static isVerbose(): boolean {
    return Logger.verbose;
  }

  constructor(private readonly module: string) {}

  debug(message: string, ...args: unknown[]): void {
    if (Logger.verbose) {
      Logger.output("DEBUG", this.module, message, args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    Logger.output("INFO", this.module, message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    Logger.output("WARN", this.module, message, args);
  }

  error(message: string, ...args: unknown[]): void {
    Logger.output("ERROR", this.module, message, args);
  }

  private static output(level: LogLevel, module: string, message: string, args: unknown[]): void {
    const timestamp = new Date().toISOString();
    const formatted = args.length > 0 ? `${message} ${args.map(String).join(" ")}` : message;
    process.stderr.write(`[${timestamp}] [${level}] [${module}] ${formatted}\n`);
  }
}

export { Logger };
