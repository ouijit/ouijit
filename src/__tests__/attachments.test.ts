import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setUserDataPath } from '../paths';
import { saveAttachment, getAttachmentsDir } from '../attachments';

describe('attachments', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-attach-'));
    setUserDataPath(tmpDir);
  });

  afterEach(() => {
    setUserDataPath('');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('saves an image into the attachments dir and returns its path', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const result = await saveAttachment(bytes, 'png');

    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();
    expect(result.path!.startsWith(getAttachmentsDir())).toBe(true);
    expect(result.path!.endsWith('.png')).toBe(true);
    expect(new Uint8Array(fs.readFileSync(result.path!))).toEqual(bytes);
  });

  test('normalizes a leading dot and uppercase in the extension', async () => {
    const result = await saveAttachment(new Uint8Array([1, 2, 3]), '.JPG');
    expect(result.success).toBe(true);
    expect(result.path!.endsWith('.jpg')).toBe(true);
  });

  test('rejects an unsupported extension', async () => {
    const result = await saveAttachment(new Uint8Array([1, 2, 3]), 'exe');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported');
  });

  test('rejects empty data', async () => {
    const result = await saveAttachment(new Uint8Array([]), 'png');
    expect(result.success).toBe(false);
    expect(result.error).toContain('empty');
  });

  test('rejects data over the size limit', async () => {
    const tooBig = new Uint8Array(25 * 1024 * 1024 + 1);
    const result = await saveAttachment(tooBig, 'png');
    expect(result.success).toBe(false);
    expect(result.error).toContain('limit');
  });

  test('generates a unique path per call', async () => {
    const a = await saveAttachment(new Uint8Array([1]), 'png');
    const b = await saveAttachment(new Uint8Array([1]), 'png');
    expect(a.path).not.toBe(b.path);
  });
});
