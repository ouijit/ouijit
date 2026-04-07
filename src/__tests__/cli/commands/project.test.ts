import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerProjectCommands } from '../../../cli/commands/project';

vi.mock('../../../cli/api', () => ({
  get: vi.fn(),
  projectQuery: (p: string) => '?project=' + encodeURIComponent(p),
}));

import { get } from '../../../cli/api';

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

function createProgram() {
  const program = new Command();
  program.exitOverride();
  registerProjectCommands(program);
  return program;
}

describe('project commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('list calls GET /api/projects', async () => {
    vi.mocked(get).mockResolvedValue([]);
    const output = captureOutput();
    await createProgram().parseAsync(['project', 'list'], { from: 'user' });
    const result = output.getJson();
    expect(get).toHaveBeenCalledWith('/api/projects');
    expect(result).toEqual([]);
  });

  test('list returns projects from API', async () => {
    vi.mocked(get).mockResolvedValue([{ name: 'project-a' }, { name: 'project-b' }]);
    const output = captureOutput();
    await createProgram().parseAsync(['project', 'list'], { from: 'user' });
    const result = output.getJson();
    expect(result).toHaveLength(2);
  });
});
