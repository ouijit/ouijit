/**
 * Logger abstraction — decouples business logic from electron-log.
 *
 * Default: console-based logger with scope prefix and structured metadata.
 * Electron app overrides via setLogger() with an electron-log adapter.
 * CLI uses the console default as-is.
 */

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  scope(name: string): Logger;
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return '';
  return ' ' + JSON.stringify(meta);
}

function createScopedConsoleLogger(scopeName: string): Logger {
  const prefix = `[${scopeName}]`;
  return {
    info: (msg, meta?) => console.log(`${prefix} ${msg}${formatMeta(meta)}`),
    warn: (msg, meta?) => console.warn(`${prefix} ${msg}${formatMeta(meta)}`),
    error: (msg, meta?) => console.error(`${prefix} ${msg}${formatMeta(meta)}`),
    scope: (name) => createScopedConsoleLogger(`${scopeName}:${name}`),
  };
}

export function createConsoleLogger(): Logger {
  return {
    info: (msg, meta?) => console.log(`${msg}${formatMeta(meta)}`),
    warn: (msg, meta?) => console.warn(`${msg}${formatMeta(meta)}`),
    error: (msg, meta?) => console.error(`${msg}${formatMeta(meta)}`),
    scope: (name) => createScopedConsoleLogger(name),
  };
}

let _logger: Logger = createConsoleLogger();

export function setLogger(logger: Logger): void {
  _logger = logger;
}

export function getLogger(): Logger {
  return _logger;
}

/**
 * Format a log entry as a JSON line.
 * Used by electron-log's file transport and tested in logger.test.ts.
 */
export function formatLogEntry(data: unknown[], level: string, scope?: string): string {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    ...(scope && { mod: scope }),
    msg: data
      .map((d: unknown) => (d instanceof Error ? d.message : typeof d === 'object' ? JSON.stringify(d) : String(d)))
      .join(' '),
  };
  // If the last arg is a plain object, spread its keys as structured metadata
  const last = data[data.length - 1];
  if (last && typeof last === 'object' && !Array.isArray(last) && !(last instanceof Error)) {
    Object.assign(entry, last);
    // Remove the object from the msg since it's now in structured fields
    entry.msg = data
      .slice(0, -1)
      .map((d: unknown) => String(d))
      .join(' ');
  }
  return JSON.stringify(entry);
}
