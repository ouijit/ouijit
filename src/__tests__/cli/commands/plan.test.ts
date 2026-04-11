import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerPlanCommands } from '../../../cli/commands/plan';

vi.mock('../../../cli/api', () => ({
  get: vi.fn(),
  post: vi.fn(),
}));

import { get, post } from '../../../cli/api';

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
  registerPlanCommands(program, () => PROJECT);
  return program;
}

describe('plan commands', () => {
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

  test('set calls POST /api/plan/:ptyId with explicit pty-id', async () => {
    vi.mocked(post).mockResolvedValue({ success: true, ptyId: 'pty123', planPath: '/tmp/plan.md' });
    const output = captureOutput();
    await createProgram().parseAsync(['plan', 'set', '/tmp/plan.md', 'pty123'], { from: 'user' });
    const result = output.getJson();
    expect(post).toHaveBeenCalledWith('/api/plan/pty123', { path: '/tmp/plan.md' });
    expect(result.success).toBe(true);
  });

  test('set falls back to OUIJIT_PTY_ID env var', async () => {
    process.env['OUIJIT_PTY_ID'] = 'env-pty';
    vi.mocked(post).mockResolvedValue({ success: true, ptyId: 'env-pty', planPath: '/tmp/plan.md' });
    const output = captureOutput();
    await createProgram().parseAsync(['plan', 'set', '/tmp/plan.md'], { from: 'user' });
    const result = output.getJson();
    expect(post).toHaveBeenCalledWith('/api/plan/env-pty', { path: '/tmp/plan.md' });
    expect(result.success).toBe(true);
  });

  test('get calls GET /api/plan/:ptyId with explicit pty-id', async () => {
    vi.mocked(get).mockResolvedValue({ ptyId: 'pty123', planPath: '/tmp/plan.md' });
    const output = captureOutput();
    await createProgram().parseAsync(['plan', 'get', 'pty123'], { from: 'user' });
    const result = output.getJson();
    expect(get).toHaveBeenCalledWith('/api/plan/pty123');
    expect(result.planPath).toBe('/tmp/plan.md');
  });

  test('get falls back to OUIJIT_PTY_ID env var', async () => {
    process.env['OUIJIT_PTY_ID'] = 'env-pty';
    vi.mocked(get).mockResolvedValue({ ptyId: 'env-pty', planPath: null });
    const output = captureOutput();
    await createProgram().parseAsync(['plan', 'get'], { from: 'user' });
    const result = output.getJson();
    expect(get).toHaveBeenCalledWith('/api/plan/env-pty');
    expect(result.planPath).toBeNull();
  });
});
