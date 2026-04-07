import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerTagCommands } from '../../../cli/commands/tag';

vi.mock('../../../cli/api', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  projectQuery: (p: string) => '?project=' + encodeURIComponent(p),
}));

import { get, post, put, del } from '../../../cli/api';

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
  registerTagCommands(program, () => PROJECT);
  return program;
}

describe('tag commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('list calls GET /api/tags', async () => {
    vi.mocked(get).mockResolvedValue([]);
    const output = captureOutput();
    await createProgram().parseAsync(['tag', 'list'], { from: 'user' });
    const result = output.getJson();
    expect(get).toHaveBeenCalledWith('/api/tags');
    expect(result).toEqual([]);
  });

  test('list --task calls GET /api/tasks/:number/tags', async () => {
    vi.mocked(get).mockResolvedValue([{ name: 'bug' }]);
    const output = captureOutput();
    await createProgram().parseAsync(['tag', 'list', '--task', '1'], { from: 'user' });
    const result = output.getJson();
    expect(get).toHaveBeenCalledWith(`/api/tasks/1/tags?project=${encodeURIComponent(PROJECT)}`);
    expect(result).toEqual([{ name: 'bug' }]);
  });

  test('add calls POST /api/tasks/:number/tags', async () => {
    vi.mocked(post).mockResolvedValue({ name: 'urgent' });
    const output = captureOutput();
    await createProgram().parseAsync(['tag', 'add', '1', 'urgent'], { from: 'user' });
    const result = output.getJson();
    expect(post).toHaveBeenCalledWith(`/api/tasks/1/tags?project=${encodeURIComponent(PROJECT)}`, { name: 'urgent' });
    expect(result.name).toBe('urgent');
  });

  test('remove calls DELETE /api/tasks/:number/tags/:name', async () => {
    vi.mocked(del).mockResolvedValue(undefined);
    const output = captureOutput();
    await createProgram().parseAsync(['tag', 'remove', '1', 'temp'], { from: 'user' });
    const result = output.getJson();
    expect(del).toHaveBeenCalledWith(`/api/tasks/1/tags/temp?project=${encodeURIComponent(PROJECT)}`);
    expect(result.success).toBe(true);
  });

  test('set calls PUT /api/tasks/:number/tags', async () => {
    vi.mocked(put).mockResolvedValue([{ name: 'alpha' }, { name: 'beta' }]);
    const output = captureOutput();
    await createProgram().parseAsync(['tag', 'set', '1', 'alpha', 'beta'], { from: 'user' });
    const result = output.getJson();
    expect(put).toHaveBeenCalledWith(`/api/tasks/1/tags?project=${encodeURIComponent(PROJECT)}`, {
      tags: ['alpha', 'beta'],
    });
    expect(result).toHaveLength(2);
  });
});
