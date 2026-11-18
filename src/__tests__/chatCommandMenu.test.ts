import { describe, test, expect } from 'vitest';
import { SHORT_LIST, commandMenu } from '../chat/commandMenu';
import { parseSlashCommand, type ChatCommand } from '../chat/model';

const COMMANDS: ChatCommand[] = [
  { name: 'deep-research', description: 'Fan-out web searches into a report' },
  { name: 'compound-writing:cw-commands', description: 'List writing workflows' },
  { name: 'compound-writing:cw-bluf', description: 'Check the bottom line comes first' },
  { name: 'humanizer:humanizer', description: 'Rewrite AI-sounding text' },
  { name: 'review', description: 'Review a pull request', argumentHint: '[pr]' },
  { name: 'compact', description: 'Summarize the conversation', argumentHint: '<optional custom instructions>' },
  { name: 'add-test', description: 'Write a test for a file', argumentHint: '<file>' },
  { name: 'model', description: 'Switch model', argumentHint: '<model>' },
  { name: 'clear', description: 'Start a new conversation' },
];
const INFO = {
  commands: COMMANDS,
  models: [
    { id: 'opus', label: 'Opus' },
    { id: 'sonnet', label: 'Sonnet' },
  ],
  efforts: [],
};
const names = (draft: string) =>
  commandMenu(draft, INFO).map((item) => (item.kind === 'command' ? item.command.name : `${item.command}:${item.id}`));

describe('the slash command menu', () => {
  test("offers Ouijit's own and the recent ones on a bare slash, and finds the rest by any part of their name or what they do", () => {
    expect(names('/')).toEqual(['clear', 'compact', 'model']);
    const bare = (recent: string[]) =>
      commandMenu('/', INFO, recent).map((item) => (item.kind === 'command' ? item.command.name : ''));
    // What was sent lately follows them, once each, and only commands the agent still has.
    expect(bare(['review', 'clear', 'gone'])).toEqual(['clear', 'compact', 'model', 'review']);
    expect(bare(COMMANDS.map((c) => c.name))).toHaveLength(SHORT_LIST);
    // The prefix a plugin puts on its commands does not bury a built-in.
    expect(names('/co')).toEqual(['compact', 'compound-writing:cw-commands', 'compound-writing:cw-bluf']);
    // Both match only in a description, so Ouijit's own order holds.
    expect(names('/conv')).toEqual(['clear', 'compact']);
    // The part after a plugin's prefix, then anywhere in a name, then the description.
    expect(names('/cw-bl')).toEqual(['compound-writing:cw-bluf']);
    expect(names('/research')).toEqual(['deep-research']);
    expect(names('/searc')).toEqual(['deep-research']);
    // A description matches on the start of a word, from three letters: "ches" is inside "searches", not its start.
    expect(names('/ches')).toEqual([]);
    expect(names('/sl')).toEqual([]);
    expect(names('/zzz')).toEqual([]);
    expect(names('hello')).toEqual([]);
  });

  test('knows which commands take something more, and offers the choices for a model', () => {
    const takes = Object.fromEntries(
      ['/compact', '/clear', '/review', '/add-test', '/model'].flatMap((draft) => {
        const [item] = commandMenu(draft, INFO);
        return item.kind === 'command' ? [[item.command.name, item.takesArgument]] : [];
      }),
    );
    // An argument marked optional, in brackets or in words, does not hold a command back.
    expect(takes).toMatchObject({ compact: false, clear: false, review: false, 'add-test': true, model: true });
    expect(names('/model ')).toEqual(['model:opus', 'model:sonnet']);
    expect(names('/model son')).toEqual(['model:sonnet']);
  });

  test('a sentence that starts with a slash is a message; only known terminal commands are held back', () => {
    expect(parseSlashCommand('/etc is weird', COMMANDS, 'claude')).toBeNull();
    expect(parseSlashCommand('/Users/me/notes.md looks wrong', COMMANDS, 'claude')).toBeNull();
    expect(parseSlashCommand('/login', COMMANDS, 'claude')).toEqual({ kind: 'terminal', name: 'login' });
    expect(parseSlashCommand('/review 12', COMMANDS, 'claude')).toEqual({ kind: 'agent', name: 'review' });
    expect(parseSlashCommand('/compact', COMMANDS, 'codex')).toMatchObject({ kind: 'conversation', action: 'compact' });
  });
});
