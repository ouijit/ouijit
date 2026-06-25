import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerPreviewCommands } from '../../../cli/commands/preview';

vi.mock('../../../cli/api', () => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}));

import { get, post, del } from '../../../cli/api';

function captureOutput() {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
    chunks.push(typeof data === 'string' ? data : data.toString());
    return true;
  });
  return {
    spy,
    getJson: () => {
      spy.mockRestore();
      return JSON.parse(chunks.join(''));
    },
  };
}

function captureStderr() {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((data) => {
    chunks.push(typeof data === 'string' ? data : data.toString());
    return true;
  });
  return {
    spy,
    getJson: () => {
      spy.mockRestore();
      return JSON.parse(chunks.join(''));
    },
  };
}

function createProgram() {
  const program = new Command();
  program.exitOverride();
  registerPreviewCommands(program);
  return program;
}

describe('preview commands', () => {
  const originalEnv = process.env['OUIJIT_PTY_ID'];

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['OUIJIT_PTY_ID'];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['OUIJIT_PTY_ID'] = originalEnv;
    } else {
      delete process.env['OUIJIT_PTY_ID'];
    }
  });

  test('add POSTs the url to the preview panels route', async () => {
    vi.mocked(post).mockResolvedValue({ ptyId: 'pty123', kind: 'preview', panels: [] });
    captureOutput();
    await createProgram().parseAsync(['preview', 'add', 'http://localhost:3000', 'pty123'], { from: 'user' });
    expect(post).toHaveBeenCalledWith('/api/panels/pty123/preview', { url: 'http://localhost:3000' });
  });

  test('add falls back to OUIJIT_PTY_ID env var', async () => {
    process.env['OUIJIT_PTY_ID'] = 'env-pty';
    vi.mocked(post).mockResolvedValue({ ptyId: 'env-pty', kind: 'preview', panels: [] });
    captureOutput();
    await createProgram().parseAsync(['preview', 'add', 'http://localhost:5173'], { from: 'user' });
    expect(post).toHaveBeenCalledWith('/api/panels/env-pty/preview', { url: 'http://localhost:5173' });
  });

  test('list GETs the preview panels route', async () => {
    vi.mocked(get).mockResolvedValue({ ptyId: 'pty123', kind: 'preview', panels: [] });
    const output = captureOutput();
    await createProgram().parseAsync(['preview', 'list', 'pty123'], { from: 'user' });
    const result = output.getJson();
    expect(get).toHaveBeenCalledWith('/api/panels/pty123/preview');
    expect(result.kind).toBe('preview');
  });

  test('remove DELETEs with the url in the query string', async () => {
    vi.mocked(del).mockResolvedValue({ ptyId: 'pty123', kind: 'preview', panels: [] });
    captureOutput();
    await createProgram().parseAsync(['preview', 'remove', 'http://localhost:3000', 'pty123'], { from: 'user' });
    expect(del).toHaveBeenCalledWith('/api/panels/pty123/preview?url=http%3A%2F%2Flocalhost%3A3000');
  });

  test('errors when no pty-id and no OUIJIT_PTY_ID env var', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const stderr = captureStderr();
    await createProgram().parseAsync(['preview', 'list'], { from: 'user' });
    const result = stderr.getJson();
    expect(result.error).toMatch(/No pty-id provided/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
