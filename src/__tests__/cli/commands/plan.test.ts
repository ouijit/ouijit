import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerPlanCommands } from '../../../cli/commands/plan';

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
  registerPlanCommands(program);
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

  test('set resolves relative paths to absolute', async () => {
    vi.mocked(post).mockResolvedValue({ success: true });
    captureOutput();
    await createProgram().parseAsync(['plan', 'set', './plan.md', 'pty123'], { from: 'user' });
    const call = vi.mocked(post).mock.calls[0];
    const sentPath = (call[1] as Record<string, unknown>).path as string;
    expect(sentPath).toMatch(/^\/.*plan\.md$/);
    expect(sentPath).not.toContain('./');
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

  test('unset calls DELETE /api/plan/:ptyId', async () => {
    vi.mocked(del).mockResolvedValue({ success: true, ptyId: 'pty123' });
    const output = captureOutput();
    await createProgram().parseAsync(['plan', 'unset', 'pty123'], { from: 'user' });
    const result = output.getJson();
    expect(del).toHaveBeenCalledWith('/api/plan/pty123');
    expect(result.success).toBe(true);
  });

  test('unset falls back to OUIJIT_PTY_ID env var', async () => {
    process.env['OUIJIT_PTY_ID'] = 'env-pty';
    vi.mocked(del).mockResolvedValue({ success: true, ptyId: 'env-pty' });
    const output = captureOutput();
    await createProgram().parseAsync(['plan', 'unset'], { from: 'user' });
    const result = output.getJson();
    expect(del).toHaveBeenCalledWith('/api/plan/env-pty');
    expect(result.success).toBe(true);
  });

  test('errors when no pty-id and no OUIJIT_PTY_ID env var', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const stderr = captureStderr();
    await createProgram().parseAsync(['plan', 'get'], { from: 'user' });
    const result = stderr.getJson();
    expect(result.error).toMatch(/No pty-id provided/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
