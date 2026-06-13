import { describe, test, expect } from 'vitest';
import { SessionBuffer } from '../sessions/buffer';

describe('SessionBuffer', () => {
  test('readAll returns appended output and tracks cursor/byteLength', () => {
    const buf = new SessionBuffer();
    buf.append('hello ');
    buf.append('world');

    expect(buf.readAll()).toBe('hello world');
    expect(buf.cursor).toBe(11);
    expect(buf.byteLength).toBe(11);
    expect(buf.isAltScreen).toBe(false);
  });

  test('readSince returns only output appended after the cursor', () => {
    const buf = new SessionBuffer();
    buf.append('aaa');
    const mark = buf.cursor;
    buf.append('bbb');
    buf.append('ccc');

    const tail = buf.readSince(mark);
    expect(tail.data).toBe('bbbccc');
    expect(tail.cursor).toBe(buf.cursor);

    // Reading from the end yields nothing.
    expect(buf.readSince(buf.cursor)).toEqual({ data: '', cursor: buf.cursor });
  });

  test('cursor is monotonic and survives trimming of the retained window', () => {
    const buf = new SessionBuffer(10);
    buf.append('12345'); // retained: 12345
    buf.append('67890'); // retained: 12345 67890 (10)
    buf.append('ABCDE'); // trims first chunk -> retained: 67890 ABCDE

    expect(buf.cursor).toBe(15); // never rewinds
    expect(buf.byteLength).toBe(10);
    expect(buf.readAll()).toBe('67890ABCDE');
  });

  test('readSince with a cursor older than the retained window returns the whole window', () => {
    const buf = new SessionBuffer(10);
    buf.append('12345');
    buf.append('67890');
    buf.append('ABCDE'); // earliest retained byte is now at absolute offset 5

    const tail = buf.readSince(0);
    expect(tail.data).toBe('67890ABCDE');
    expect(tail.cursor).toBe(15);
  });

  test('tracks alternate-screen transitions', () => {
    const buf = new SessionBuffer();
    buf.append('\x1b[?1049h');
    expect(buf.isAltScreen).toBe(true);
    buf.append('\x1b[?1049l');
    expect(buf.isAltScreen).toBe(false);
  });

  test('round-trips through DurableBufferRef', () => {
    const buf = new SessionBuffer();
    buf.append('one');
    buf.append('two');

    const ref = buf.toDurable();
    expect(ref).toEqual({ kind: 'inline', chunks: ['one', 'two'] });

    const restored = SessionBuffer.fromDurable(ref);
    expect(restored.readAll()).toBe('onetwo');
    expect(restored.cursor).toBe(6);
  });

  test('fromDurable yields an empty buffer for a file reference', () => {
    const restored = SessionBuffer.fromDurable({ kind: 'file', path: '/tmp/x', byteLength: 999 });
    expect(restored.readAll()).toBe('');
    expect(restored.byteLength).toBe(0);
  });
});
