import { describe, test, expect, vi, beforeEach } from 'vitest';
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
