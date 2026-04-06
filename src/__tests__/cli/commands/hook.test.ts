import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { _resetCacheForTesting, getHooks, addProject } from '../../../db';
import { registerHookCommands } from '../../../cli/commands/hook';

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
  beforeEach(async () => {
    _resetCacheForTesting();
    await addProject(PROJECT);
  });

  test('list returns empty hooks for new project', async () => {
    const output = captureOutput();
    await createProgram().parseAsync(['hook', 'list'], { from: 'user' });
    const result = output.getJson();
    expect(result).toEqual({});
  });

  test('set creates a hook', async () => {
    const output = captureOutput();
    await createProgram().parseAsync(['hook', 'set', 'review', '--name', 'Review', '--command', 'echo reviewed'], {
      from: 'user',
    });
    const result = output.getJson();
    expect(result.success).toBe(true);

    const hooks = await getHooks(PROJECT);
    expect(hooks.review).toBeDefined();
    expect(hooks.review?.command).toBe('echo reviewed');
  });

  test('get retrieves a hook by type', async () => {
    // First create a hook
    const output1 = captureOutput();
    await createProgram().parseAsync(['hook', 'set', 'start', '--name', 'Start', '--command', 'echo start'], {
      from: 'user',
    });
    output1.getJson();

    // Then get it
    const output2 = captureOutput();
    await createProgram().parseAsync(['hook', 'get', 'start'], { from: 'user' });
    const result = output2.getJson();
    expect(result.name).toBe('Start');
    expect(result.command).toBe('echo start');
  });

  test('delete removes a hook', async () => {
    // Create then delete
    const output1 = captureOutput();
    await createProgram().parseAsync(['hook', 'set', 'cleanup', '--name', 'Cleanup', '--command', 'echo clean'], {
      from: 'user',
    });
    output1.getJson();

    const output2 = captureOutput();
    await createProgram().parseAsync(['hook', 'delete', 'cleanup'], { from: 'user' });
    const result = output2.getJson();
    expect(result.success).toBe(true);

    const hooks = await getHooks(PROJECT);
    expect(hooks.cleanup).toBeUndefined();
  });
});
