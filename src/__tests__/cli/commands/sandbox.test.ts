import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerSandboxCommands } from '../../../cli/commands/sandbox';

import { get, put, del } from '../../../cli/api';

vi.mock('../../../cli/api', () => ({
  get: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  projectQuery: (p: string) => '?project=' + encodeURIComponent(p),
}));

function captureOutput() {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
    chunks.push(typeof data === 'string' ? data : data.toString());
    return true;
  });
  return () => {
    spy.mockRestore();
    return JSON.parse(chunks.join(''));
  };
}

const PROJECT = '/test/project';
const QUERY = `?project=${encodeURIComponent(PROJECT)}`;

function createProgram() {
  const program = new Command();
  program.exitOverride();
  registerSandboxCommands(program, () => PROJECT);
  return program;
}

describe('sandbox-command commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('get, set, and clear map onto /api/sandbox/command', async () => {
    vi.mocked(get).mockResolvedValue({ command: '/opt/sb' });
    let output = captureOutput();
    await createProgram().parseAsync(['sandbox-command', 'get'], { from: 'user' });
    expect(get).toHaveBeenCalledWith(`/api/sandbox/command${QUERY}`);
    expect(output()).toEqual({ command: '/opt/sb' });

    vi.mocked(put).mockResolvedValue({ success: true });
    output = captureOutput();
    await createProgram().parseAsync(['sandbox-command', 'set', '/opt/sb --strict'], { from: 'user' });
    expect(put).toHaveBeenCalledWith(`/api/sandbox/command${QUERY}`, { command: '/opt/sb --strict' });
    expect(output().success).toBe(true);

    vi.mocked(del).mockResolvedValue({ success: true });
    output = captureOutput();
    await createProgram().parseAsync(['sandbox-command', 'clear'], { from: 'user' });
    expect(del).toHaveBeenCalledWith(`/api/sandbox/command${QUERY}`);
    expect(output().success).toBe(true);
  });
});
