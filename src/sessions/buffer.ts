/**
 * Concrete {@link TerminalBuffer} for durable sessions (task #462).
 *
 * An append-only ring of output chunks with a monotonic byte cursor. The cursor
 * counts every byte ever appended (it never rewinds), so {@link readSince} can
 * tail incrementally even after the retained window has trimmed older bytes —
 * exactly the contract the renderer port (#461) and projection (#463) read
 * through. Chunks are retained per-write (not concatenated on every append) to
 * avoid string-churn under heavy output, matching the existing ptyManager
 * history buffer.
 *
 * "bytes" here means JavaScript string length (UTF-16 code units), consistent
 * with how `ptyManager` measures PTY output — cursors are internally consistent,
 * not a guarantee of UTF-8 byte offsets.
 */
import type { BufferCursor, DurableBufferRef, TerminalBuffer } from './model';

/** Default retained scroll-back window (100KB), matching ptyManager. */
export const DEFAULT_MAX_BUFFER_SIZE = 100 * 1024;

export class SessionBuffer implements TerminalBuffer {
  private chunks: string[] = [];
  /** Bytes currently retained in `chunks`. */
  private retained = 0;
  /** Total bytes ever appended — the monotonic end cursor. */
  private total = 0;
  private altScreen = false;

  constructor(private readonly maxBufferSize: number = DEFAULT_MAX_BUFFER_SIZE) {}

  get cursor(): BufferCursor {
    return this.total;
  }

  get byteLength(): number {
    return this.retained;
  }

  get isAltScreen(): boolean {
    return this.altScreen;
  }

  /** Absolute cursor of the earliest byte still retained. */
  private get earliest(): BufferCursor {
    return this.total - this.retained;
  }

  /**
   * Append new PTY output. Tracks alternate-screen (TUI) transitions and trims
   * the oldest chunks once the retained window exceeds the cap.
   */
  append(data: string): void {
    if (!data) return;

    // Track alternate-screen mode (smcup/rmcup) for accurate replay.
    if (data.includes('\x1b[?1049h') || data.includes('\x1b[?47h')) this.altScreen = true;
    if (data.includes('\x1b[?1049l') || data.includes('\x1b[?47l')) this.altScreen = false;

    this.chunks.push(data);
    this.retained += data.length;
    this.total += data.length;

    while (this.retained > this.maxBufferSize && this.chunks.length > 1) {
      const removed = this.chunks.shift()!;
      this.retained -= removed.length;
    }
  }

  readAll(): string {
    return this.chunks.join('');
  }

  readSince(cursor: BufferCursor): { data: string; cursor: BufferCursor } {
    // Caller already current (or ahead): nothing new.
    if (cursor >= this.total) return { data: '', cursor: this.total };
    // Cursor older than what we still retain: hand back the whole window.
    const from = Math.max(cursor, this.earliest);
    const offset = from - this.earliest;
    const data = offset === 0 ? this.readAll() : this.readAll().slice(offset);
    return { data, cursor: this.total };
  }

  /** Serialize the retained window to the persisted buffer reference. */
  toDurable(): DurableBufferRef {
    return { kind: 'inline', chunks: [...this.chunks] };
  }

  /**
   * Rehydrate a buffer from its persisted reference. Only the inline form is
   * produced today; a `file` reference (chosen later for very large scroll-back)
   * is read from disk by the caller and replayed via {@link append}, so here it
   * yields an empty buffer rather than reaching for the filesystem.
   */
  static fromDurable(ref: DurableBufferRef, maxBufferSize: number = DEFAULT_MAX_BUFFER_SIZE): SessionBuffer {
    const buffer = new SessionBuffer(maxBufferSize);
    if (ref.kind === 'inline') {
      for (const chunk of ref.chunks) buffer.append(chunk);
    }
    return buffer;
  }
}
