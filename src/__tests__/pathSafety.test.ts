import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveWithinBase, SymlinkEscapeError, isSymlinkEscapeError } from '../utils/pathSafety';

let base: string;
let outside: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'pathsafety-base-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pathsafety-out-'));
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe('resolveWithinBase', () => {
  test('allows a plain file inside the base', async () => {
    fs.writeFileSync(path.join(base, 'a.txt'), 'hi');
    const resolved = await resolveWithinBase(base, 'a.txt');
    expect(resolved).toBe(fs.realpathSync(path.join(base, 'a.txt')));
  });

  test('allows a nested file inside the base', async () => {
    fs.mkdirSync(path.join(base, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(base, 'sub', 'b.txt'), 'hi');
    const resolved = await resolveWithinBase(base, 'sub/b.txt');
    expect(resolved.endsWith('sub' + path.sep + 'b.txt')).toBe(true);
  });

  test('allows a symlink whose target stays inside the base', async () => {
    fs.writeFileSync(path.join(base, 'real.txt'), 'real');
    fs.symlinkSync(path.join(base, 'real.txt'), path.join(base, 'link.txt'));
    const resolved = await resolveWithinBase(base, 'link.txt');
    expect(resolved.endsWith('real.txt')).toBe(true);
  });

  test('rejects ../.. traversal', async () => {
    await expect(resolveWithinBase(base, '../../etc/passwd')).rejects.toBeInstanceOf(SymlinkEscapeError);
  });

  test('rejects symlink that escapes the base', async () => {
    const target = path.join(outside, 'secret.txt');
    fs.writeFileSync(target, 'secret');
    fs.symlinkSync(target, path.join(base, 'escape.txt'));
    await expect(resolveWithinBase(base, 'escape.txt')).rejects.toBeInstanceOf(SymlinkEscapeError);
  });

  test('rejects symlink chain that ultimately escapes', async () => {
    const target = path.join(outside, 'secret.txt');
    fs.writeFileSync(target, 'secret');
    fs.symlinkSync(target, path.join(base, 'hop1.txt'));
    fs.symlinkSync(path.join(base, 'hop1.txt'), path.join(base, 'hop2.txt'));
    await expect(resolveWithinBase(base, 'hop2.txt')).rejects.toBeInstanceOf(SymlinkEscapeError);
  });

  test('rejects symlinked parent that escapes', async () => {
    fs.symlinkSync(outside, path.join(base, 'escaped-dir'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    await expect(resolveWithinBase(base, 'escaped-dir/secret.txt')).rejects.toBeInstanceOf(SymlinkEscapeError);
  });

  test('handles non-existent leaf with safe parent', async () => {
    const resolved = await resolveWithinBase(base, 'notyetcreated.txt');
    expect(resolved.endsWith('notyetcreated.txt')).toBe(true);
  });

  test('rejects non-existent leaf whose parent symlink escapes', async () => {
    fs.symlinkSync(outside, path.join(base, 'outlink'));
    await expect(resolveWithinBase(base, 'outlink/newfile.txt')).rejects.toBeInstanceOf(SymlinkEscapeError);
  });

  test('isSymlinkEscapeError matches only SymlinkEscapeError', () => {
    expect(isSymlinkEscapeError(new SymlinkEscapeError('x', '/y', '/z'))).toBe(true);
    expect(isSymlinkEscapeError(new Error('nope'))).toBe(false);
    expect(isSymlinkEscapeError('string')).toBe(false);
  });
});
