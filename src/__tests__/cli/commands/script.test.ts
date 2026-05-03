import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerScriptCommands } from '../../../cli/commands/script';

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
  registerScriptCommands(program, () => PROJECT);
  return program;
}

describe('script commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('list calls GET /api/scripts', async () => {
    vi.mocked(get).mockResolvedValue([]);
    const output = captureOutput();
    await createProgram().parseAsync(['script', 'list'], { from: 'user' });
    const result = output.getJson();
    expect(get).toHaveBeenCalledWith(`/api/scripts?project=${encodeURIComponent(PROJECT)}`);
    expect(result).toEqual([]);
  });

  test('set creates a new script with a generated id when none exists by name', async () => {
    vi.mocked(get).mockResolvedValue([]);
    vi.mocked(put).mockResolvedValue({ success: true, script: { name: 'Lint', command: 'npm run lint' } });
    const output = captureOutput();
    await createProgram().parseAsync(['script', 'set', '--name', 'Lint', '--command', 'npm run lint'], {
      from: 'user',
    });
    const result = output.getJson();
    expect(get).toHaveBeenCalledWith(`/api/scripts?project=${encodeURIComponent(PROJECT)}`);
    expect(put).toHaveBeenCalledTimes(1);
    const [url, body] = vi.mocked(put).mock.calls[0];
    expect(typeof body.id).toBe('string');
    expect(body.id).not.toBe('');
    expect(url).toBe(`/api/scripts/${encodeURIComponent(body.id)}?project=${encodeURIComponent(PROJECT)}`);
    expect(body).toMatchObject({ name: 'Lint', command: 'npm run lint', sortOrder: 0 });
    expect(result.name).toBe('Lint');
  });

  test('set reuses the existing id when a script with the same name already exists', async () => {
    vi.mocked(get).mockResolvedValue([{ id: 'existing-id', name: 'Lint', command: 'old', sortOrder: 0 }]);
    vi.mocked(put).mockResolvedValue({ success: true, script: { name: 'Lint', command: 'npm run lint' } });
    captureOutput();
    await createProgram().parseAsync(['script', 'set', '--name', 'Lint', '--command', 'npm run lint'], {
      from: 'user',
    });
    expect(put).toHaveBeenCalledWith(`/api/scripts/existing-id?project=${encodeURIComponent(PROJECT)}`, {
      id: 'existing-id',
      name: 'Lint',
      command: 'npm run lint',
      sortOrder: 0,
    });
  });

  test('delete calls DELETE /api/scripts/:id', async () => {
    vi.mocked(del).mockResolvedValue({ success: true });
    const output = captureOutput();
    await createProgram().parseAsync(['script', 'delete', 'script-123'], { from: 'user' });
    const result = output.getJson();
    expect(del).toHaveBeenCalledWith(`/api/scripts/script-123?project=${encodeURIComponent(PROJECT)}`);
    expect(result.success).toBe(true);
  });
});
