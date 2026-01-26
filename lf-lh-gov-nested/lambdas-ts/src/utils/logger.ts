/**
 * Logging utility
 */

export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  info(message: string, meta?: Record<string, unknown>): void {
    console.log(JSON.stringify({
      level: 'INFO',
      context: this.context,
      message,
      ...meta,
      timestamp: new Date().toISOString(),
    }));
  }

  error(message: string, error?: Error, meta?: Record<string, unknown>): void {
    console.error(JSON.stringify({
      level: 'ERROR',
      context: this.context,
      message,
      error: error?.message,
      stack: error?.stack,
      ...meta,
      timestamp: new Date().toISOString(),
    }));
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(JSON.stringify({
      level: 'WARN',
      context: this.context,
      message,
      ...meta,
      timestamp: new Date().toISOString(),
    }));
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (process.env.LOG_LEVEL === 'DEBUG') {
      console.log(JSON.stringify({
        level: 'DEBUG',
        context: this.context,
        message,
        ...meta,
        timestamp: new Date().toISOString(),
      }));
    }
  }
}
