import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { _resetCacheForTesting, getScripts, addProject } from '../../../db';
import { registerScriptCommands } from '../../../cli/commands/script';

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
  beforeEach(async () => {
    _resetCacheForTesting();
    await addProject(PROJECT);
  });

  test('list returns empty array for new project', async () => {
    const output = captureOutput();
    await createProgram().parseAsync(['script', 'list'], { from: 'user' });
    const result = output.getJson();
    expect(result).toEqual([]);
  });

  test('set creates a script', async () => {
    const output = captureOutput();
    await createProgram().parseAsync(['script', 'set', '--name', 'Lint', '--command', 'npm run lint'], {
      from: 'user',
    });
    const result = output.getJson();
    expect(result.name).toBe('Lint');
    expect(result.command).toBe('npm run lint');

    const scripts = await getScripts(PROJECT);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].name).toBe('Lint');
  });

  test('delete removes a script', async () => {
    // Create
    const output1 = captureOutput();
    await createProgram().parseAsync(['script', 'set', '--name', 'Test', '--command', 'npm test'], { from: 'user' });
    const created = output1.getJson();

    // Delete
    const output2 = captureOutput();
    await createProgram().parseAsync(['script', 'delete', created.id], { from: 'user' });
    const result = output2.getJson();
    expect(result.success).toBe(true);

    const scripts = await getScripts(PROJECT);
    expect(scripts).toHaveLength(0);
  });

  test('list returns scripts in order', async () => {
    const out1 = captureOutput();
    await createProgram().parseAsync(['script', 'set', '--name', 'First', '--command', 'echo 1'], { from: 'user' });
    out1.getJson();

    const out2 = captureOutput();
    await createProgram().parseAsync(['script', 'set', '--name', 'Second', '--command', 'echo 2'], { from: 'user' });
    out2.getJson();

    const out3 = captureOutput();
    await createProgram().parseAsync(['script', 'list'], { from: 'user' });
    const scripts = out3.getJson();
    expect(scripts).toHaveLength(2);
    expect(scripts[0].name).toBe('First');
    expect(scripts[1].name).toBe('Second');
  });
});
