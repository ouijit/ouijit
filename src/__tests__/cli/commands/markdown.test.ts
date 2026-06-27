import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerMarkdownCommands } from '../../../cli/commands/markdown';

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
  registerMarkdownCommands(program);
  return program;
}

describe('markdown commands', () => {
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

  test('add POSTs a resolved absolute path to the markdown panels route', async () => {
    vi.mocked(post).mockResolvedValue({ ptyId: 'pty123', kind: 'markdown', panels: [] });
    const output = captureOutput();
    await createProgram().parseAsync(['markdown', 'add', './notes.md', 'pty123'], { from: 'user' });
    output.getJson();
    const [url, body] = vi.mocked(post).mock.calls[0];
    expect(url).toBe('/api/panels/pty123/markdown');
    const sentPath = (body as Record<string, unknown>).path as string;
    expect(sentPath).toMatch(/^\/.*notes\.md$/);
    expect(sentPath).not.toContain('./');
  });

  test('add falls back to OUIJIT_PTY_ID env var', async () => {
    process.env['OUIJIT_PTY_ID'] = 'env-pty';
    vi.mocked(post).mockResolvedValue({ ptyId: 'env-pty', kind: 'markdown', panels: [] });
    captureOutput();
    await createProgram().parseAsync(['markdown', 'add', '/tmp/notes.md'], { from: 'user' });
    expect(post).toHaveBeenCalledWith('/api/panels/env-pty/markdown', { path: '/tmp/notes.md' });
  });

  test('list GETs the markdown panels route', async () => {
    vi.mocked(get).mockResolvedValue({ ptyId: 'pty123', kind: 'markdown', panels: [] });
    const output = captureOutput();
    await createProgram().parseAsync(['markdown', 'list', 'pty123'], { from: 'user' });
    const result = output.getJson();
    expect(get).toHaveBeenCalledWith('/api/panels/pty123/markdown');
    expect(result.kind).toBe('markdown');
  });

  test('remove DELETEs with the resolved path in the query string', async () => {
    vi.mocked(del).mockResolvedValue({ ptyId: 'pty123', kind: 'markdown', panels: [] });
    captureOutput();
    await createProgram().parseAsync(['markdown', 'remove', '/tmp/notes.md', 'pty123'], { from: 'user' });
    expect(del).toHaveBeenCalledWith('/api/panels/pty123/markdown?path=%2Ftmp%2Fnotes.md');
  });

  test('errors when no pty-id and no OUIJIT_PTY_ID env var', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const stderr = captureStderr();
    await createProgram().parseAsync(['markdown', 'list'], { from: 'user' });
    const result = stderr.getJson();
    expect(result.error).toMatch(/No pty-id provided/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
