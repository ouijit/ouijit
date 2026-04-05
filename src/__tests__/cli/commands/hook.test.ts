import { describe, test, expect, vi, beforeEach } from 'vitest';
import { _resetCacheForTesting, getHooks, addProject } from '../../../db';
import { handleHookCommand } from '../../../cli/commands/hook';

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

describe('hook commands', () => {
  beforeEach(async () => {
    _resetCacheForTesting();
    await addProject(PROJECT);
  });

  test('list returns empty hooks for new project', async () => {
    const output = captureOutput();
    await handleHookCommand('list', [], {}, () => PROJECT);
    const result = output.getJson();
    expect(result).toEqual({});
  });

  test('set creates a hook', async () => {
    const output = captureOutput();
    await handleHookCommand('set', ['review'], { name: 'Review', command: 'echo reviewed' }, () => PROJECT);
    const result = output.getJson();
    expect(result.success).toBe(true);

    const hooks = await getHooks(PROJECT);
    expect(hooks.review).toBeDefined();
    expect(hooks.review?.command).toBe('echo reviewed');
  });

  test('get retrieves a hook by type', async () => {
    // First create a hook
    const output1 = captureOutput();
    await handleHookCommand('set', ['start'], { name: 'Start', command: 'echo start' }, () => PROJECT);
    output1.getJson();

    // Then get it
    const output2 = captureOutput();
    await handleHookCommand('get', ['start'], {}, () => PROJECT);
    const result = output2.getJson();
    expect(result.name).toBe('Start');
    expect(result.command).toBe('echo start');
  });

  test('delete removes a hook', async () => {
    // Create then delete
    const output1 = captureOutput();
    await handleHookCommand('set', ['cleanup'], { name: 'Cleanup', command: 'echo clean' }, () => PROJECT);
    output1.getJson();

    const output2 = captureOutput();
    await handleHookCommand('delete', ['cleanup'], {}, () => PROJECT);
    const result = output2.getJson();
    expect(result.success).toBe(true);

    const hooks = await getHooks(PROJECT);
    expect(hooks.cleanup).toBeUndefined();
  });
});
