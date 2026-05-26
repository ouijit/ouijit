import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerTaskCommands } from '../../../cli/commands/task';

vi.mock('../../../cli/api', () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  projectQuery: (p: string) => '?project=' + encodeURIComponent(p),
}));

import { get, post, patch, del } from '../../../cli/api';

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
  registerTaskCommands(program, () => PROJECT);
  return program;
}

describe('task commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('list calls GET /api/tasks', async () => {
    vi.mocked(get).mockResolvedValue([{ taskNumber: 1, name: 'Task A' }]);
    const output = captureOutput();
    await createProgram().parseAsync(['task', 'list'], { from: 'user' });
    const result = output.getJson();
    expect(get).toHaveBeenCalledWith(`/api/tasks?project=${encodeURIComponent(PROJECT)}`);
    expect(result).toEqual([{ taskNumber: 1, name: 'Task A' }]);
  });

  test('get calls GET /api/tasks/:number', async () => {
    vi.mocked(get).mockResolvedValue({ taskNumber: 1, name: 'My task' });
    const output = captureOutput();
    await createProgram().parseAsync(['task', 'get', '1'], { from: 'user' });
    const result = output.getJson();
    expect(get).toHaveBeenCalledWith(`/api/tasks/1?project=${encodeURIComponent(PROJECT)}`);
    expect(result.name).toBe('My task');
  });

  describe('current', () => {
    const ORIGINAL_PTY_ID = process.env['OUIJIT_PTY_ID'];

    afterEach(() => {
      if (ORIGINAL_PTY_ID === undefined) delete process.env['OUIJIT_PTY_ID'];
      else process.env['OUIJIT_PTY_ID'] = ORIGINAL_PTY_ID;
    });

    test('calls GET /api/tasks/current with no project query', async () => {
      process.env['OUIJIT_PTY_ID'] = 'pty-123';
      vi.mocked(get).mockResolvedValue({ taskNumber: 7, name: 'Owned task' });
      const output = captureOutput();
      await createProgram().parseAsync(['task', 'current'], { from: 'user' });
      const result = output.getJson();
      expect(get).toHaveBeenCalledWith('/api/tasks/current');
      expect(result.taskNumber).toBe(7);
    });

    test('errors and exits non-zero when OUIJIT_PTY_ID is unset', async () => {
      delete process.env['OUIJIT_PTY_ID'];
      const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as never);
      try {
        await expect(createProgram().parseAsync(['task', 'current'], { from: 'user' })).rejects.toThrow(/exit:1/);
        expect(get).not.toHaveBeenCalled();
        expect(errSpy).toHaveBeenCalled();
      } finally {
        errSpy.mockRestore();
        exitSpy.mockRestore();
      }
    });
  });

  test('create calls POST /api/tasks', async () => {
    vi.mocked(post).mockResolvedValue({ success: true, task: { name: 'Test task' } });
    const output = captureOutput();
    await createProgram().parseAsync(['task', 'create', 'Test task', '--prompt', 'Do stuff'], { from: 'user' });
    const result = output.getJson();
    expect(post).toHaveBeenCalledWith(`/api/tasks?project=${encodeURIComponent(PROJECT)}`, {
      name: 'Test task',
      prompt: 'Do stuff',
    });
    expect(result.success).toBe(true);
  });

  describe('start hook flags', () => {
    test('start with no hook flag omits hookMode', async () => {
      vi.mocked(post).mockResolvedValue({ success: true });
      const output = captureOutput();
      await createProgram().parseAsync(['task', 'start', '3'], { from: 'user' });
      output.getJson();
      expect(post).toHaveBeenCalledWith(`/api/tasks/3/start?project=${encodeURIComponent(PROJECT)}`, {
        branchName: undefined,
      });
    });

    test('start --run-hook sends hookMode run', async () => {
      vi.mocked(post).mockResolvedValue({ success: true });
      const output = captureOutput();
      await createProgram().parseAsync(['task', 'start', '3', '--run-hook'], { from: 'user' });
      output.getJson();
      expect(post).toHaveBeenCalledWith(`/api/tasks/3/start?project=${encodeURIComponent(PROJECT)}`, {
        branchName: undefined,
        hookMode: 'run',
      });
    });

    test('start --skip-hook sends hookMode skip', async () => {
      vi.mocked(post).mockResolvedValue({ success: true });
      const output = captureOutput();
      await createProgram().parseAsync(['task', 'start', '3', '--skip-hook'], { from: 'user' });
      output.getJson();
      expect(post).toHaveBeenCalledWith(`/api/tasks/3/start?project=${encodeURIComponent(PROJECT)}`, {
        branchName: undefined,
        hookMode: 'skip',
      });
    });

    test('start --hook-command sends hookMode command + hookCommand', async () => {
      vi.mocked(post).mockResolvedValue({ success: true });
      const output = captureOutput();
      await createProgram().parseAsync(['task', 'start', '3', '--hook-command', 'claude'], { from: 'user' });
      output.getJson();
      expect(post).toHaveBeenCalledWith(`/api/tasks/3/start?project=${encodeURIComponent(PROJECT)}`, {
        branchName: undefined,
        hookMode: 'command',
        hookCommand: 'claude',
      });
    });

    test('create-and-start --run-hook sends hookMode run', async () => {
      vi.mocked(post).mockResolvedValue({ success: true });
      const output = captureOutput();
      await createProgram().parseAsync(['task', 'create-and-start', 'New task', '--run-hook'], { from: 'user' });
      output.getJson();
      expect(post).toHaveBeenCalledWith(`/api/tasks/start?project=${encodeURIComponent(PROJECT)}`, {
        name: 'New task',
        prompt: undefined,
        branchName: undefined,
        hookMode: 'run',
      });
    });

    test('mutually exclusive hook flags error and exit non-zero', async () => {
      const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as never);
      try {
        await expect(
          createProgram().parseAsync(['task', 'start', '3', '--run-hook', '--skip-hook'], { from: 'user' }),
        ).rejects.toThrow(/exit:1/);
        expect(post).not.toHaveBeenCalled();
        expect(errSpy).toHaveBeenCalled();
      } finally {
        errSpy.mockRestore();
        exitSpy.mockRestore();
      }
    });
  });

  test('set-status calls PATCH /api/tasks/:number/status', async () => {
    vi.mocked(patch).mockResolvedValue({ success: true });
    const output = captureOutput();
    await createProgram().parseAsync(['task', 'set-status', '1', 'in_progress'], { from: 'user' });
    const result = output.getJson();
    expect(patch).toHaveBeenCalledWith(`/api/tasks/1/status?project=${encodeURIComponent(PROJECT)}`, {
      status: 'in_progress',
    });
    expect(result.success).toBe(true);
  });

  describe('set-status done hook flags', () => {
    test('done with no flags sends just the status', async () => {
      vi.mocked(patch).mockResolvedValue({ success: true });
      const output = captureOutput();
      await createProgram().parseAsync(['task', 'set-status', '1', 'done'], { from: 'user' });
      output.getJson();
      expect(patch).toHaveBeenCalledWith(expect.any(String), { status: 'done' });
    });

    test('done --skip-hook forwards skipHook in the body', async () => {
      vi.mocked(patch).mockResolvedValue({ success: true });
      const output = captureOutput();
      await createProgram().parseAsync(['task', 'set-status', '1', 'done', '--skip-hook'], { from: 'user' });
      output.getJson();
      expect(patch).toHaveBeenCalledWith(expect.any(String), { status: 'done', skipHook: true });
    });

    test('done --hook-command forwards hookCommand', async () => {
      vi.mocked(patch).mockResolvedValue({ success: true });
      const output = captureOutput();
      await createProgram().parseAsync(['task', 'set-status', '1', 'done', '--hook-command', 'npm run deploy'], {
        from: 'user',
      });
      output.getJson();
      expect(patch).toHaveBeenCalledWith(expect.any(String), { status: 'done', hookCommand: 'npm run deploy' });
    });

    test('done with both --skip-hook and --hook-command exits non-zero', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await createProgram().parseAsync(['task', 'set-status', '1', 'done', '--skip-hook', '--hook-command', 'x'], {
          from: 'user',
        });
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        exitSpy.mockRestore();
        errSpy.mockRestore();
      }
    });

    test('done with empty --hook-command exits non-zero', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await createProgram().parseAsync(['task', 'set-status', '1', 'done', '--hook-command', '  '], { from: 'user' });
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        exitSpy.mockRestore();
        errSpy.mockRestore();
      }
    });

    test('hook flags on non-done status exit non-zero (no silent ignore)', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await createProgram().parseAsync(['task', 'set-status', '1', 'in_review', '--skip-hook'], { from: 'user' });
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        exitSpy.mockRestore();
        errSpy.mockRestore();
      }
    });
  });

  describe('bulk-set-status', () => {
    test('fans out N parallel PATCH requests and aggregates success', async () => {
      vi.mocked(patch).mockResolvedValue({ success: true });
      const output = captureOutput();
      await createProgram().parseAsync(['task', 'bulk-set-status', 'in_review', '1', '2', '3'], { from: 'user' });
      const result = output.getJson();

      expect(patch).toHaveBeenCalledTimes(3);
      expect(patch).toHaveBeenCalledWith(expect.stringContaining('/api/tasks/1/status'), { status: 'in_review' });
      expect(patch).toHaveBeenCalledWith(expect.stringContaining('/api/tasks/2/status'), { status: 'in_review' });
      expect(patch).toHaveBeenCalledWith(expect.stringContaining('/api/tasks/3/status'), { status: 'in_review' });
      expect(result).toEqual({ success: true, status: 'In Review', succeeded: [1, 2, 3], failed: [] });
    });

    test('done forwards --skip-hook to every task', async () => {
      vi.mocked(patch).mockResolvedValue({ success: true });
      const output = captureOutput();
      await createProgram().parseAsync(['task', 'bulk-set-status', 'done', '5', '6', '--skip-hook'], { from: 'user' });
      output.getJson();
      expect(patch).toHaveBeenCalledWith(expect.stringContaining('/api/tasks/5/status'), {
        status: 'done',
        skipHook: true,
      });
      expect(patch).toHaveBeenCalledWith(expect.stringContaining('/api/tasks/6/status'), {
        status: 'done',
        skipHook: true,
      });
    });

    test('aggregates per-task failures without rejecting the whole batch', async () => {
      vi.mocked(patch)
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'not found' })
        .mockResolvedValueOnce({ success: true });
      const output = captureOutput();
      await createProgram().parseAsync(['task', 'bulk-set-status', 'done', '1', '2', '3'], { from: 'user' });
      const result = output.getJson();
      expect(result).toEqual({
        success: false,
        status: 'Done',
        succeeded: [1, 3],
        failed: [{ taskNumber: 2, error: 'not found' }],
      });
    });

    test('rejects --skip-hook + --hook-command together', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await createProgram().parseAsync(
          ['task', 'bulk-set-status', 'done', '1', '2', '--skip-hook', '--hook-command', 'x'],
          { from: 'user' },
        );
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        exitSpy.mockRestore();
        errSpy.mockRestore();
      }
    });

    test('rejects non-integer task numbers', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await createProgram().parseAsync(['task', 'bulk-set-status', 'done', '1', 'abc'], { from: 'user' });
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        exitSpy.mockRestore();
        errSpy.mockRestore();
      }
    });
  });

  test('set-name calls PATCH /api/tasks/:number/name', async () => {
    vi.mocked(patch).mockResolvedValue({ success: true });
    const output = captureOutput();
    await createProgram().parseAsync(['task', 'set-name', '1', 'New', 'name'], { from: 'user' });
    const result = output.getJson();
    expect(patch).toHaveBeenCalledWith(`/api/tasks/1/name?project=${encodeURIComponent(PROJECT)}`, {
      name: 'New name',
    });
    expect(result.success).toBe(true);
  });

  test('delete calls DELETE /api/tasks/:number', async () => {
    vi.mocked(del).mockResolvedValue({ success: true });
    const output = captureOutput();
    await createProgram().parseAsync(['task', 'delete', '1'], { from: 'user' });
    const result = output.getJson();
    expect(del).toHaveBeenCalledWith(`/api/tasks/1?project=${encodeURIComponent(PROJECT)}`);
    expect(result.success).toBe(true);
  });
});
