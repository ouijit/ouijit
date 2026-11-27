import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import log from '../../log';

vi.unmock('electron-log/main');

let tmpDir: string;
let logPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-log-file-'));
  logPath = path.join(tmpDir, 'ouijit.log');
  log.transports.file.resolvePathFn = () => logPath;
  log.transports.console.level = false;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('the app log file', () => {
  test('holds one UTF-8 JSON object per line, whatever was logged', () => {
    log.info('plain line');
    log.scope('worktree').warn('starting task', { taskNumber: 5, branch: 'føø-☃-🚀' });
    log.error('failed', new Error('boom'));
    log.info('100% done %s %d');

    const bytes = fs.readFileSync(logPath);
    expect(bytes.includes(0)).toBe(false);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);

    const entries = text
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(entries).toMatchObject([
      { level: 'info', msg: 'plain line' },
      { level: 'warn', mod: 'worktree', msg: 'starting task', taskNumber: 5, branch: 'føø-☃-🚀' },
      { level: 'error', msg: 'failed boom' },
      { level: 'info', msg: '100% done %s %d' },
    ]);
  });
});
