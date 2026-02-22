import log from 'electron-log/main';

/**
 * Format a log entry as a JSON line.
 * Exported for testing — not intended for direct use.
 */
export function formatLogEntry(
  data: unknown[],
  level: string,
  scope?: string,
): string {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    ...(scope && { mod: scope }),
    msg: data.map((d: unknown) =>
      d instanceof Error ? d.message : typeof d === 'object' ? JSON.stringify(d) : String(d)
    ).join(' '),
  };
  // If the last arg is a plain object, spread its keys as structured metadata
  const last = data[data.length - 1];
  if (last && typeof last === 'object' && !Array.isArray(last) && !(last instanceof Error)) {
    Object.assign(entry, last);
    // Remove the object from the msg since it's now in structured fields
    entry.msg = data.slice(0, -1).map((d: unknown) => String(d)).join(' ');
  }
  return JSON.stringify(entry);
}

// JSON lines format for the file transport
// The type expects any[] but file transport actually accepts a string return
(log.transports.file.format as unknown) = ({ data, level, message }: { data: unknown[]; level: string; message: { scope?: string } }) => {
  return formatLogEntry(data, level, message.scope);
};

// File rotation: 5MB max, keep rotated .old file
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.fileName = 'ouijit.log';

// Console transport: keep default text format for dev readability

// Capture uncaught errors
log.errorHandler.startCatching();

export default log;
