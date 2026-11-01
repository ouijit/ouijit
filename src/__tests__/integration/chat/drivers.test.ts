/**
 * Each agent driver, through the real chat host, against a cassette of that
 * agent's own stdio. Re-record with `RECORD_CASSETTES=1` and the agents
 * installed and signed in; replay needs neither.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ChatHost } from '../../../chat/host';
import { getDriver } from '../../../chat/drivers';
import { _resetCacheForTesting, setGlobalSetting } from '../../../db';
import type { ChatAgentId, ChatNode, ChatSnapshot, RequestNode, ToolCallNode } from '../../../chat/model';
import { loadCassette, loadCassettes, recording, recordingSpawn, replayingSpawn, cassettePath } from './cassette';

const FOLLOW_UP = 'What is the name of the file you just created? Reply with only the file name.';
const PROMPT =
  'Create a file named hello.txt containing the single word hi, using your file editing tool. Then reply with exactly: done';

let fakeBin: string;
const originalPath = process.env.PATH;

beforeAll(() => {
  _resetCacheForTesting();
  if (recording) return;
  fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-agents-'));
  for (const agent of ['claude', 'codex', 'pi', 'opencode'] as const) {
    if (!fs.existsSync(cassettePath(agent))) continue;
    const { version } = loadCassette(agent);
    fs.writeFileSync(path.join(fakeBin, agent), `#!/bin/sh\necho "${version ?? '99.0.0'}"\n`, { mode: 0o755 });
  }
  process.env.PATH = `${fakeBin}:${originalPath}`;
  // Claude's history import reads its session files in-process rather than
  // through the agent's stdio, so replay points it at an empty config dir.
  process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-claude-'));
});

afterAll(() => {
  process.env.PATH = originalPath;
  delete process.env.CLAUDE_CONFIG_DIR;
});

function repo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-chat-')));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

async function until(
  host: ChatHost,
  id: string,
  done: (snapshot: ChatSnapshot) => boolean,
  timeoutMs: number,
): Promise<ChatSnapshot> {
  const started = Date.now();
  for (;;) {
    const snapshot = host.snapshot(id)!;
    if (done(snapshot)) return snapshot;
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `timed out; status ${snapshot.info.status} ${snapshot.info.statusDetail ?? ''}\n${JSON.stringify(snapshot.nodes.map((n) => ('text' in n ? `${n.kind}: ${n.text.slice(0, 80)}` : n.kind)))}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Says yes to whatever the agent asks, from outside, the way a second client would. */
function approveEverything(host: ChatHost): () => void {
  return host.subscribe((sessionId, { event }) => {
    if (event.type !== 'node' || event.node.kind !== 'request' || event.node.status !== 'pending') return;
    const request = event.node as RequestNode;
    const allow = request.options.find((option) => option.kind === 'allow_once') ?? request.options[0];
    setImmediate(() =>
      host.answer(
        sessionId,
        request.id,
        allow ? { kind: 'option', optionId: allow.id } : { kind: 'answers', answers: {} },
      ),
    );
  });
}

const timeout = recording ? 240_000 : 20_000;

async function hostFor(
  agent: ChatAgentId,
): Promise<{ host: ChatHost; spawn: ReturnType<typeof replayingSpawn> | null }> {
  if (recording) {
    const probe = await getDriver(agent).probe();
    return { host: new ChatHost({ spawnProcess: recordingSpawn(agent, agent, probe.version) }), spawn: null };
  }
  const spawn = replayingSpawn(loadCassettes(agent));
  return { host: new ChatHost({ spawnProcess: spawn }), spawn };
}

function kinds(nodes: ChatNode[]): string[] {
  return nodes.map((node) => node.kind);
}

describe.each(['claude', 'codex', 'pi', 'opencode'] as const)('%s in chat', (agent) => {
  const available = recording || fs.existsSync(cassettePath(agent));

  test.skipIf(!available)(
    'runs a turn that edits a file, keeps the transcript, and resumes the conversation',
    async () => {
      const cwd = repo();
      const { host } = await hostFor(agent);
      const stop = approveEverything(host);
      const id = `pty-test-${agent}`;

      const started = await host.start({ id, agent, projectPath: cwd, cwd, taskId: null });
      expect(started.info.status, started.info.statusDetail).toBe('idle');
      expect(started.info.capabilities.interrupt).toBe(true);

      await host.prompt(id, { text: PROMPT });
      const finished = await until(
        host,
        id,
        (s) => s.info.status === 'idle' && s.nodes.some((n) => n.kind === 'assistant_message' && /done/i.test(n.text)),
        timeout,
      );

      expect(finished.info.agentSessionId).toBeTruthy();
      const users = finished.nodes.filter((n) => n.kind === 'user_message');
      expect(users.map((n) => n.text)).toEqual([PROMPT]);
      const edit = finished.nodes.find(
        (n): n is ToolCallNode => n.kind === 'tool_call' && (n.tool === 'edit' || n.tool === 'command'),
      );
      expect(edit, JSON.stringify(kinds(finished.nodes))).toBeDefined();
      expect(edit!.status).toBe('completed');
      expect(finished.nodes.every((n) => n.kind !== 'request' || n.status !== 'pending')).toBe(true);

      await host.stop(id);
      const stored = host.snapshot(id)!;
      expect(stored.info.status).toBe('exited');
      expect(kinds(stored.nodes)).toEqual(kinds(finished.nodes));
      if (recording) {
        expect(fs.readFileSync(path.join(cwd, 'hello.txt'), 'utf8').trim()).toBe('hi');
      }

      // A second process picks the same conversation up: the agent remembers
      // the first turn, and the transcript keeps it.
      const resumed = await host.start({ id, agent, projectPath: cwd, cwd, taskId: null });
      expect(resumed.info.status, resumed.info.statusDetail).toBe('idle');
      expect(resumed.info.agentSessionId).toBe(finished.info.agentSessionId);
      await host.prompt(id, { text: FOLLOW_UP });
      const after = await until(
        host,
        id,
        (s) =>
          s.info.status === 'idle' &&
          s.nodes.filter((n) => n.kind === 'assistant_message' && /hello\.txt/i.test(n.text)).length > 0,
        timeout,
      );
      expect(after.nodes.filter((n) => n.kind === 'user_message').map((n) => n.text)).toEqual([PROMPT, FOLLOW_UP]);
      await host.stop(id);
      stop();
    },
    timeout * 2,
  );
});

describe.each(['claude', 'codex', 'pi', 'opencode'] as const)('%s steered mid-turn', (agent) => {
  const name = `${agent}-steer`;
  const available = recording || fs.existsSync(cassettePath(name));

  test.skipIf(!available)(
    'a message sent while the agent works joins the running turn',
    async () => {
      const cwd = repo();
      const probe = recording ? await getDriver(agent).probe() : null;
      const host = new ChatHost({
        spawnProcess: recording ? recordingSpawn(name, agent, probe?.version) : replayingSpawn(loadCassettes(name)),
      });
      const stop = approveEverything(host);
      const id = `pty-steer-${agent}`;
      await host.start({ id, agent, projectPath: cwd, cwd, taskId: null });

      await host.prompt(id, { text: 'Run the shell command `sleep 6` and then tell me it finished.' });
      await until(host, id, (s) => s.nodes.some((n) => n.kind === 'tool_call' && n.status === 'running'), timeout);
      await host.prompt(id, { text: 'Also end your final reply with the word banana.' });

      const done = await until(
        host,
        id,
        (s) =>
          s.info.status === 'idle' && s.nodes.some((n) => n.kind === 'assistant_message' && /banana/i.test(n.text)),
        timeout,
      );
      const users = done.nodes.filter((n) => n.kind === 'user_message');
      expect(users.map((n) => n.delivery)).toEqual(['prompt', 'steer']);
      await host.stop(id);
      stop();
    },
    timeout * 2,
  );
});

describe('claude rewound and forked', () => {
  const available = recording || fs.existsSync(cassettePath('claude-rewind'));

  test.skipIf(!available)(
    'a rewind forgets the later message, and a fork carries the conversation into a new session',
    async () => {
      const cwd = repo();
      const probe = recording ? await getDriver('claude').probe() : null;
      const host = new ChatHost({
        spawnProcess: recording
          ? recordingSpawn('claude-rewind', 'claude', probe?.version)
          : replayingSpawn(loadCassettes('claude-rewind')),
      });
      const id = 'pty-rewind';
      const idle = (min: number) => (s: ChatSnapshot) =>
        s.info.status === 'idle' && s.nodes.filter((n) => n.kind === 'assistant_message').length >= min;
      await host.start({ id, agent: 'claude', projectPath: cwd, cwd, taskId: null });
      await host.prompt(id, { text: 'Remember the word apple. Reply with only: ok' });
      await until(host, id, idle(1), timeout);
      const pear = await host.prompt(id, { text: 'Forget apple; remember the word pear instead. Reply with only: ok' });
      await until(host, id, idle(2), timeout);

      await host.rewind(id, pear);
      expect(host.snapshot(id)!.nodes.some((n) => n.id === pear)).toBe(false);
      await host.prompt(id, { text: 'Which word did I ask you to remember? Reply with only the word.' });
      const rewound = await until(
        host,
        id,
        (s) => s.info.status === 'idle' && s.nodes.some((n) => n.kind === 'assistant_message' && /apple/i.test(n.text)),
        timeout,
      );
      expect(rewound.nodes.some((n) => n.kind === 'assistant_message' && /pear/i.test(n.text))).toBe(false);

      const fork = await host.fork(id);
      expect(fork.info.id).not.toBe(id);
      expect(fork.info.status).toBe('idle');
      const forkedFrom = rewound.info.agentSessionId;
      await host.prompt(fork.info.id, { text: 'Repeat the word you are remembering. Reply with only the word.' });
      const forked = await until(
        host,
        fork.info.id,
        (s) =>
          s.info.status === 'idle' &&
          s.nodes.filter((n) => n.kind === 'assistant_message' && /apple/i.test(n.text)).length >= 2,
        timeout,
      );
      expect(forked.info.agentSessionId).not.toBe(forkedFrom);
      await host.stop(fork.info.id);
      await host.stop(id);
    },
    timeout * 3,
  );
});

describe('pi with approvals on', () => {
  const available = recording || fs.existsSync(cassettePath('pi-approvals'));

  test.skipIf(!available)(
    'asks before a tool call, and a decline keeps the file from being written',
    async () => {
      const cwd = repo();
      await setGlobalSetting('chat:piApprovals', '1');
      const probe = recording ? await getDriver('pi').probe() : null;
      const host = new ChatHost({
        spawnProcess: recording
          ? recordingSpawn('pi-approvals', 'pi', probe?.version)
          : replayingSpawn(loadCassettes('pi-approvals')),
      });
      const stop = host.subscribe((sessionId, { event }) => {
        if (event.type !== 'node' || event.node.kind !== 'request' || event.node.status !== 'pending') return;
        const block = event.node.options.find((option) => option.kind === 'reject_once');
        if (block) setImmediate(() => host.answer(sessionId, event.node.id, { kind: 'option', optionId: block.id }));
      });
      const id = 'pty-pi-approvals';
      await host.start({ id, agent: 'pi', projectPath: cwd, cwd, taskId: null });
      await host.prompt(id, {
        text: 'Use your write tool to create hello.txt containing hi. If it is blocked, reply with exactly: blocked',
      });
      const done = await until(
        host,
        id,
        (s) =>
          s.info.status === 'idle' && s.nodes.some((n) => n.kind === 'assistant_message' && /blocked/i.test(n.text)),
        timeout,
      );
      const request = done.nodes.find((n): n is RequestNode => n.kind === 'request');
      expect(request?.toolCallId).toMatch(/^pi-tool-/);
      expect(request?.options.map((option) => option.kind)).toEqual(['allow_once', 'allow_always', 'reject_once']);
      expect(request?.status).toBe('answered');
      if (recording) expect(fs.existsSync(path.join(cwd, 'hello.txt'))).toBe(false);
      await setGlobalSetting('chat:piApprovals', '');
      await host.stop(id);
      stop();
    },
    timeout * 2,
  );
});

describe('an ACP agent in chat', () => {
  test('streams thought, plan and a gated edit into the transcript, and offers its modes and commands', async () => {
    const cwd = repo();
    await setGlobalSetting('chat:acpCommand', 'fake-acp-agent --stdio');
    const host = new ChatHost({ spawnProcess: replayingSpawn([loadCassette('acp')]) });
    const stop = approveEverything(host);
    const id = 'pty-test-acp';

    const started = await host.start({ id, agent: 'acp', projectPath: cwd, cwd, taskId: null });
    expect(started.info.status, started.info.statusDetail).toBe('idle');
    expect(started.info.agentSessionId).toBe('sess-1');
    expect(started.info.modes.map((mode) => mode.id)).toEqual(['ask', 'code']);
    expect(started.info.mode).toBe('ask');

    await host.prompt(id, { text: 'PROMPT' });
    const done = await until(
      host,
      id,
      (s) => s.info.status === 'idle' && s.nodes.some((n) => n.kind === 'assistant_message'),
      5000,
    );

    expect(kinds(done.nodes)).toEqual([
      'user_message',
      'reasoning',
      'plan',
      'tool_call',
      'request',
      'assistant_message',
    ]);
    expect(done.nodes.filter((n) => 'status' in n && n.status === 'running')).toEqual([]);
    const edit = done.nodes.find((n): n is ToolCallNode => n.kind === 'tool_call')!;
    expect(edit.status).toBe('completed');
    expect(edit.files).toEqual([{ path: 'hello.txt', change: 'add', diff: expect.stringContaining('+hi') }]);
    const plan = done.nodes.find((n) => n.kind === 'plan');
    expect(plan && 'entries' in plan ? plan.entries : []).toEqual([{ text: 'Write hello.txt', status: 'completed' }]);
    const reply = done.nodes.find((n) => n.kind === 'assistant_message');
    expect(reply && 'text' in reply ? reply.text : '').toBe('done');
    expect(done.info.commands.map((command) => command.name)).toEqual(['review']);

    await host.stop(id);
    stop();
  });
});
