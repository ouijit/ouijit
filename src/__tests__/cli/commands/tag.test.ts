import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { _resetCacheForTesting, addProject, createTask, getTaskTags } from '../../../db';
import { registerTagCommands } from '../../../cli/commands/tag';

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
  beforeEach(async () => {
    _resetCacheForTesting();
    await addProject(PROJECT);
    await createTask(PROJECT, 1, 'Test task');
  });

  test('list returns all tags', async () => {
    const output = captureOutput();
    await createProgram().parseAsync(['tag', 'list'], { from: 'user' });
    const result = output.getJson();
    expect(Array.isArray(result)).toBe(true);
  });

  test('add creates a tag for a task', async () => {
    const output = captureOutput();
    await createProgram().parseAsync(['tag', 'add', '1', 'urgent'], { from: 'user' });
    const result = output.getJson();
    expect(result.name).toBe('urgent');

    const tags = await getTaskTags(PROJECT, 1);
    expect(tags.some((t) => t.name === 'urgent')).toBe(true);
  });

  test('remove deletes a tag from a task', async () => {
    // Add then remove
    const output1 = captureOutput();
    await createProgram().parseAsync(['tag', 'add', '1', 'temp'], { from: 'user' });
    output1.getJson();

    const output2 = captureOutput();
    await createProgram().parseAsync(['tag', 'remove', '1', 'temp'], { from: 'user' });
    const result = output2.getJson();
    expect(result.success).toBe(true);

    const tags = await getTaskTags(PROJECT, 1);
    expect(tags.some((t) => t.name === 'temp')).toBe(false);
  });

  test('set replaces all tags on a task', async () => {
    const output = captureOutput();
    await createProgram().parseAsync(['tag', 'set', '1', 'alpha', 'beta'], { from: 'user' });
    const result = output.getJson();
    expect(result).toHaveLength(2);

    const tags = await getTaskTags(PROJECT, 1);
    expect(tags.map((t) => t.name).sort()).toEqual(['alpha', 'beta']);
  });

  test('list --task filters tags for a specific task', async () => {
    // Add a tag first
    const output1 = captureOutput();
    await createProgram().parseAsync(['tag', 'add', '1', 'filtered'], { from: 'user' });
    output1.getJson();

    const output2 = captureOutput();
    await createProgram().parseAsync(['tag', 'list', '--task', '1'], { from: 'user' });
    const result = output2.getJson();
    expect(result.some((t: { name: string }) => t.name === 'filtered')).toBe(true);
  });
});
