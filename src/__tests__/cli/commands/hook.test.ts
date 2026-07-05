import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerHookCommands } from '../../../cli/commands/hook';

vi.mock('../../../cli/api', () => ({
  get: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  projectQuery: (p: string) => '?project=' + encodeURIComponent(p),
}));

import { get, put, del } from '../../../cli/api';

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

const PROJECT = '/test/project';

function createProgram() {
  const program = new Command();
  program.exitOverride();
  registerHookCommands(program, () => PROJECT);
  return program;
}

describe('hook commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('list calls GET /api/hooks', async () => {
    vi.mocked(get).mockResolvedValue({});
    const output = captureOutput();
    await createProgram().parseAsync(['hook', 'list'], { from: 'user' });
    const result = output.getJson();
    expect(get).toHaveBeenCalledWith(`/api/hooks?project=${encodeURIComponent(PROJECT)}`);
    expect(result).toEqual({});
  });

  test('set calls PUT /api/hooks/:type', async () => {
    vi.mocked(put).mockResolvedValue({ success: true });
    const output = captureOutput();
    await createProgram().parseAsync(['hook', 'set', 'review', '--name', 'Review', '--command', 'echo reviewed'], {
      from: 'user',
    });
    const result = output.getJson();
    expect(put).toHaveBeenCalledWith(`/api/hooks/review?project=${encodeURIComponent(PROJECT)}`, {
      name: 'Review',
      command: 'echo reviewed',
    });
    expect(result.success).toBe(true);
  });

  test('set accepts --restart-if-running for the run hook', async () => {
    vi.mocked(put).mockResolvedValue({ success: true });
    const output = captureOutput();
    await createProgram().parseAsync(
      ['hook', 'set', 'run', '--name', 'Dev', '--command', 'npm run dev', '--restart-if-running'],
      { from: 'user' },
    );
    output.getJson();
    expect(put).toHaveBeenCalledWith(`/api/hooks/run?project=${encodeURIComponent(PROJECT)}`, {
      name: 'Dev',
      command: 'npm run dev',
      restartIfRunning: true,
    });
  });

  test('set rejects --restart-if-running for non-run hooks', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await expect(
      createProgram().parseAsync(
        ['hook', 'set', 'start', '--name', 'Setup', '--command', 'npm install', '--restart-if-running'],
        { from: 'user' },
      ),
    ).rejects.toThrow('exit');
    expect(put).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('only valid for the run hook'));
    exit.mockRestore();
    stderr.mockRestore();
  });

  test('get retrieves a hook by type from hooks object', async () => {
    vi.mocked(get).mockResolvedValue({ start: { name: 'Start', command: 'echo start' } });
    const output = captureOutput();
    await createProgram().parseAsync(['hook', 'get', 'start'], { from: 'user' });
    const result = output.getJson();
    expect(result.name).toBe('Start');
  });

  test('delete calls DELETE /api/hooks/:type', async () => {
    vi.mocked(del).mockResolvedValue({ success: true });
    const output = captureOutput();
    await createProgram().parseAsync(['hook', 'delete', 'done'], { from: 'user' });
    const result = output.getJson();
    expect(del).toHaveBeenCalledWith(`/api/hooks/done?project=${encodeURIComponent(PROJECT)}`);
    expect(result.success).toBe(true);
  });
});
