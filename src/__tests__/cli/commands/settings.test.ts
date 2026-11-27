import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import * as path from 'node:path';
import { Command } from 'commander';
import { registerSettingsCommands } from '../../../cli/commands/settings';

import { get, post, put, del } from '../../../cli/api';

vi.mock('../../../cli/api', () => ({
  get: vi.fn(async () => ({})),
  post: vi.fn(async () => ({})),
  put: vi.fn(async () => ({})),
  del: vi.fn(async () => ({})),
  projectQuery: (p: string) => '?project=' + encodeURIComponent(p),
}));

const PROJECT = '/test/project';
const Q = `?project=${encodeURIComponent(PROJECT)}`;

async function run(...args: string[]) {
  const program = new Command();
  program.exitOverride();
  registerSettingsCommands(program, async () => PROJECT);
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await program.parseAsync(['settings', ...args], { from: 'user' });
  } finally {
    stdout.mockRestore();
  }
}

/** Runs a command that must be refused before anything is sent, and returns what it said. */
async function refused(...args: string[]): Promise<string> {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exit');
  }) as never);
  try {
    await expect(run(...args)).rejects.toThrow('exit');
    return String(stderr.mock.lastCall?.[0]);
  } finally {
    stderr.mockRestore();
    exit.mockRestore();
  }
}

function stdin(text: string) {
  const stream = Readable.from([text]);
  return vi.spyOn(process, 'stdin', 'get').mockReturnValue(stream as unknown as typeof process.stdin);
}

describe('settings commands', () => {
  beforeEach(() => vi.clearAllMocks());

  test("a project's settings send only the flags given, in the API's words, with long text from stdin", async () => {
    await run('tasks', 'set', '--surface', 'chat', '--agent', 'codex');
    expect(put).toHaveBeenLastCalledWith(`/api/task-opening${Q}`, { surface: 'chat', agent: 'codex' });
    const piped = stdin('Read PLAN.md\nthen start');
    await run('tasks', 'set', '--first-message', '-');
    piped.mockRestore();
    expect(put).toHaveBeenLastCalledWith(`/api/task-opening${Q}`, { firstMessage: 'Read PLAN.md\nthen start' });

    await run('worktree', 'set', '--branch-from', '');
    expect(put).toHaveBeenLastCalledWith(`/api/worktree-settings${Q}`, { branchFrom: '' });

    await run('lens', 'add', 'Risk first', '--instruction', 'Riskiest first');
    expect(post).toHaveBeenLastCalledWith(`/api/project-lenses${Q}`, {
      name: 'Risk first',
      instruction: 'Riskiest first',
    });
    await run('lens', 'edit', 'Risk first', '--name', 'Risk');
    expect(put).toHaveBeenLastCalledWith(`/api/project-lenses/Risk%20first${Q}`, { name: 'Risk' });
    await run('lens', 'remove', 'Risk');
    expect(del).toHaveBeenLastCalledWith(`/api/project-lenses/Risk${Q}`);
    await run('lens', 'agent', 'set', 'auto');
    expect(put).toHaveBeenLastCalledWith(`/api/lens-agent${Q}`, { agent: 'auto' });

    await run('sandbox', 'set', '--default', 'host', '--profile', 'profiles/strict.json', '--cli-access', 'own-task');
    expect(put).toHaveBeenLastCalledWith(`/api/sandbox-settings${Q}`, {
      default: 'none',
      profile: path.resolve('profiles/strict.json'),
      cliAccess: 'own-task',
    });
    await run('sandbox', 'get');
    expect(get).toHaveBeenLastCalledWith(`/api/sandbox-settings${Q}`);
  });

  test("Chat's settings are sent app-wide, wakes and all", async () => {
    await run('chat', 'set', '--disable', '--sandbox', 'nono', '--wake', 'taskMoved=off', '--wake', 'asked=on');
    expect(put).toHaveBeenLastCalledWith('/api/chat-settings', {
      enabled: false,
      sandbox: 'nono',
      wake: { taskMoved: false, asked: true },
    });
    await run('chat', 'set', '--instructions', '');
    expect(put).toHaveBeenLastCalledWith('/api/chat-settings', { instructions: '' });
  });

  test('a bad or empty set is refused before anything is sent', async () => {
    expect(await refused('tasks', 'set')).toContain('Nothing to set');
    expect(await refused('tasks', 'set', '--surface', 'window')).toContain('terminal or chat');
    expect(await refused('tasks', 'set', '--agent', 'gpt')).toContain('claude|codex|pi|opencode|acp');
    expect(await refused('sandbox', 'set', '--default', 'vm')).toContain('host|nono|custom');
    expect(await refused('chat', 'set', '--enable', '--disable')).toContain('not both');
    expect(await refused('chat', 'set', '--wake', 'taskMoved')).toContain('<event>=on');
    expect(put).not.toHaveBeenCalled();
  });
});
