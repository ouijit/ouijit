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
import { deflateSync } from 'node:zlib';
import { ChatHost } from '../../../chat/host';
import { CLI_REFERENCE, getCliReferencePath } from '../../../hookServer';
import { getDriver } from '../../../chat/drivers';
import { _resetCacheForTesting, getChatRepo, setGlobalSetting } from '../../../db';
import { NO_CAPABILITIES } from '../../../chat/model';
import type { ChatAgentId, ChatNode, ChatSnapshot, RequestNode, ToolCallNode } from '../../../chat/model';
import { loadCassette, loadCassettes, recording, recordingSpawn, replayingSpawn, cassettePath } from './cassette';

const FOLLOW_UP = 'What is the name of the file you just created? Reply with only the file name.';
const PROMPT =
  'Create a file named hello.txt containing the single word hi, using your file editing tool. Then reply with exactly: done';

let fakeBin: string;
const originalPath = process.env.PATH;

beforeAll(() => {
  _resetCacheForTesting();
  // Every agent is handed the CLI reference the app installs; the test home has none until this.
  fs.mkdirSync(path.dirname(getCliReferencePath()), { recursive: true });
  fs.writeFileSync(getCliReferencePath(), CLI_REFERENCE);
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

describe.each(['claude', 'codex', 'pi', 'opencode', 'acp'] as const)('%s in chat', (agent) => {
  const available = recording || fs.existsSync(cassettePath(agent));

  test.skipIf(!available)(
    'runs a turn that edits a file, keeps the transcript, and resumes the conversation',
    async () => {
      const cwd = repo();
      // The generic ACP driver, run against a real ACP agent: opencode's own ACP mode.
      if (agent === 'acp') await setGlobalSetting('chat:acpCommand', 'opencode acp');
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

describe.each(['claude', 'codex', 'pi', 'opencode', 'acp'] as const)('%s told about Ouijit', (agent) => {
  const name = `${agent}-cli`;
  const available = recording || fs.existsSync(cassettePath(name));

  test.skipIf(!available)(
    'knows the ouijit CLI from the reference it is handed, without being shown it',
    async () => {
      const cwd = repo();
      if (agent === 'acp') await setGlobalSetting('chat:acpCommand', 'opencode acp');
      const probe = recording ? await getDriver(agent).probe() : null;
      const host = new ChatHost({
        spawnProcess: recording ? recordingSpawn(name, agent, probe?.version) : replayingSpawn(loadCassettes(name)),
      });
      const id = `pty-cli-${agent}`;
      await host.start({ id, agent, projectPath: cwd, cwd, taskId: null });
      await host.prompt(id, {
        text: 'Without running anything: what single shell command lists the tasks of this Ouijit project? Reply with only the command.',
      });
      const done = await until(
        host,
        id,
        (s) => s.info.status === 'idle' && s.nodes.some((n) => n.kind === 'assistant_message' && n.text.trim() !== ''),
        timeout,
      );
      const reply = done.nodes
        .filter((n) => n.kind === 'assistant_message')
        .map((n) => n.text)
        .join('\n');
      expect(reply).toMatch(/ouijit task list/);
      await host.stop(id);
    },
    timeout * 2,
  );
});

describe.each(['claude', 'codex', 'pi', 'opencode', 'acp'] as const)('%s cleared', (agent) => {
  const name = `${agent}-clear`;
  const available = recording || fs.existsSync(cassettePath(name));

  test.skipIf(!available)(
    '/clear empties the transcript and the agent forgets the conversation, as in its terminal',
    async () => {
      const cwd = repo();
      if (agent === 'acp') await setGlobalSetting('chat:acpCommand', 'opencode acp');
      const probe = recording ? await getDriver(agent).probe() : null;
      const host = new ChatHost({
        spawnProcess: recording ? recordingSpawn(name, agent, probe?.version) : replayingSpawn(loadCassettes(name)),
      });
      const id = `pty-clear-${agent}`;
      await host.start({ id, agent, projectPath: cwd, cwd, taskId: null });
      await until(host, id, (s) => s.info.commands.some((c) => c.name === 'clear'), timeout);

      await host.prompt(id, { text: 'Remember the secret word apple. Reply with only: ok' });
      await until(
        host,
        id,
        (s) => s.info.status === 'idle' && s.nodes.some((n) => n.kind === 'assistant_message'),
        timeout,
      );
      const before = host.snapshot(id)!.info.agentSessionId;

      await host.prompt(id, { text: '/clear' });
      await until(host, id, (s) => s.nodes.length === 0 && s.info.agentSessionId !== before, timeout);

      await host.prompt(id, {
        text: 'What secret word did I ask you to remember? If none, reply with only: none',
      });
      const after = await until(
        host,
        id,
        (s) => s.info.status === 'idle' && s.nodes.some((n) => n.kind === 'assistant_message'),
        timeout,
      );
      expect(after.nodes.filter((n) => n.kind === 'user_message').map((n) => n.text)).toEqual([
        'What secret word did I ask you to remember? If none, reply with only: none',
      ]);
      const reply = after.nodes
        .filter((n) => n.kind === 'assistant_message')
        .map((n) => n.text)
        .join(' ');
      expect(reply).not.toMatch(/apple/i);
      await host.stop(id);
    },
    timeout * 3,
  );
});

/** A 64×64 PNG of one solid colour, so the only thing to say about it is the colour. */
function solidPng(file: string, [r, g, b]: [number, number, number]): void {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const size = 64;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).fill(Buffer.from([r, g, b]))]);
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

describe.each(['claude', 'codex', 'pi', 'opencode', 'acp'] as const)('%s seeing an image', (agent) => {
  const name = `${agent}-image`;
  const available = recording || fs.existsSync(cassettePath(name));

  test.skipIf(!available)(
    'an attached image reaches the agent as an image it can see',
    async () => {
      const cwd = repo();
      if (agent === 'acp') await setGlobalSetting('chat:acpCommand', 'opencode acp');
      const probe = recording ? await getDriver(agent).probe() : null;
      const host = new ChatHost({
        spawnProcess: recording ? recordingSpawn(name, agent, probe?.version) : replayingSpawn(loadCassettes(name)),
      });
      const id = `pty-image-${agent}`;
      const image = path.join(cwd, 'swatch.png');
      solidPng(image, [220, 20, 20]);
      await host.start({ id, agent, projectPath: cwd, cwd, taskId: null });
      expect(host.snapshot(id)!.info.capabilities.images).toBe(true);

      await host.prompt(id, {
        text: 'What single colour fills the attached image? Do not use any tools. Reply with only the colour name.',
        attachments: [{ path: image, name: 'swatch.png', mimeType: 'image/png' }],
      });
      const done = await until(
        host,
        id,
        (s) => s.info.status === 'idle' && s.nodes.some((n) => n.kind === 'assistant_message'),
        timeout,
      );
      const sent = done.nodes.find((n) => n.kind === 'user_message');
      expect(sent && 'attachments' in sent ? sent.attachments?.map((a) => a.name) : []).toEqual(['swatch.png']);
      const reply = done.nodes
        .filter((n) => n.kind === 'assistant_message')
        .map((n) => n.text)
        .join(' ');
      expect(reply).toMatch(/red/i);
      await host.stop(id);
    },
    timeout * 2,
  );
});

describe('claude background work', () => {
  const name = 'claude-background';
  const available = recording || fs.existsSync(cassettePath(name));

  test.skipIf(!available)(
    'a shell the agent leaves running is listed until it is stopped from the chat',
    async () => {
      const cwd = repo();
      const probe = recording ? await getDriver('claude').probe() : null;
      const host = new ChatHost({
        spawnProcess: recording ? recordingSpawn(name, 'claude', probe?.version) : replayingSpawn(loadCassettes(name)),
      });
      const unsubscribe = approveEverything(host);
      const id = 'pty-background-claude';
      await host.start({ id, agent: 'claude', projectPath: cwd, cwd, taskId: null });

      await host.prompt(id, {
        text: 'Use your Bash tool with run_in_background set to true to run: sleep 600. Do not wait for it. Then reply with only: started',
      });
      const running = await until(
        host,
        id,
        (s) => s.info.status === 'idle' && (s.info.background ?? []).some((task) => task.kind === 'shell'),
        timeout,
      );
      const shell = running.info.background!.find((task) => task.kind === 'shell')!;
      expect(shell.description).toBeTruthy();

      await host.stopBackground(id, shell.id);
      await until(host, id, (s) => !(s.info.background ?? []).some((task) => task.id === shell.id), timeout);
      unsubscribe();
      await host.stop(id);
    },
    timeout * 2,
  );
});

describe('claude mode', () => {
  const name = 'claude-mode';
  const available = recording || fs.existsSync(cassettePath(name));

  test.skipIf(!available)(
    'the mode picked in a chat holds when Claude is restarted for an effort change and when the chat is reopened',
    async () => {
      const cwd = repo();
      const probe = recording ? await getDriver('claude').probe() : null;
      const host = new ChatHost({
        spawnProcess: recording ? recordingSpawn(name, 'claude', probe?.version) : replayingSpawn(loadCassettes(name)),
      });
      const id = 'pty-mode-claude';
      const replied = (count: number) => (s: ChatSnapshot) =>
        s.info.status === 'idle' && s.nodes.filter((n) => n.kind === 'assistant_message').length >= count;
      await host.start({ id, agent: 'claude', projectPath: cwd, cwd, taskId: null });
      await host.setMode(id, 'acceptEdits');
      await host.setEffort(id, 'high');
      await host.prompt(id, { text: 'Reply with only: ok' });
      expect((await until(host, id, replied(1), timeout)).info.mode).toBe('acceptEdits');

      await host.stop(id);
      await host.start({ id, agent: 'claude', projectPath: cwd, cwd, taskId: null });
      await host.prompt(id, { text: 'Reply with only: again' });
      expect((await until(host, id, replied(2), timeout)).info.mode).toBe('acceptEdits');
      await host.stop(id);
    },
    timeout * 3,
  );
});

describe('claude subagents', () => {
  const name = 'claude-subagents';
  const available = recording || fs.existsSync(cassettePath(name));

  test.skipIf(!available)(
    'a subagent is finished when it finishes, whether its call waited for it or it ran in the background',
    async () => {
      const cwd = repo();
      const probe = recording ? await getDriver('claude').probe() : null;
      const host = new ChatHost({
        spawnProcess: recording ? recordingSpawn(name, 'claude', probe?.version) : replayingSpawn(loadCassettes(name)),
      });
      const id = 'pty-subagents-claude';
      await host.start({ id, agent: 'claude', projectPath: cwd, cwd, taskId: null });
      await host.prompt(id, {
        text:
          'Launch two subagents with the Agent tool in one message. The first runs normally; the second sets ' +
          'run_in_background to true. Each must use no tools and reply with only: ok. Do not wait for the ' +
          'background one; reply with only: launched',
      });
      const done = await until(
        host,
        id,
        (s) => {
          const subagents = s.nodes.filter((n) => n.kind === 'subagent');
          return s.info.status === 'idle' && subagents.length === 2 && subagents.every((n) => n.status === 'completed');
        },
        timeout * 2,
      );
      expect(done.nodes.filter((n) => n.kind === 'subagent')).toHaveLength(2);
      await host.stop(id);
    },
    timeout * 3,
  );
});

describe('a chat reopened after its agent is gone', () => {
  test('settles the work that was still running: a launched subagent as done, the rest as stopped', async () => {
    const cwd = repo();
    const id = 'pty-settle';
    const info = {
      id,
      agent: 'acp',
      agentSessionId: null,
      projectPath: cwd,
      cwd,
      worktreePath: null,
      sandbox: null,
      taskId: null,
      status: 'running',
      capabilities: NO_CAPABILITIES,
      models: [],
      efforts: [],
      modes: [],
      commands: [],
    };
    const tool = (nodeId: string, status: ToolCallNode['status'], kind: ToolCallNode['tool']): ToolCallNode => ({
      id: nodeId,
      kind: 'tool_call',
      parentId: null,
      createdAt: 0,
      tool: kind,
      name: kind,
      title: nodeId,
      input: {},
      files: [],
      status,
    });
    const nodes: ChatNode[] = [
      tool('launched', 'completed', 'subagent'),
      { id: 'background', kind: 'subagent', parentId: 'launched', createdAt: 0, title: 'b', status: 'running' },
      tool('waiting', 'running', 'subagent'),
      { id: 'foreground', kind: 'subagent', parentId: 'waiting', createdAt: 0, title: 'f', status: 'running' },
      tool('read', 'completed', 'read'),
    ];
    const now = new Date().toISOString();
    getChatRepo().save(
      {
        id,
        project_path: cwd,
        task_id: null,
        cwd,
        worktree_path: null,
        agent: 'acp',
        agent_session_id: null,
        sandbox_provider: null,
        info: JSON.stringify(info),
        seq: 7,
        created_at: now,
        updated_at: now,
      },
      nodes.map((node, position) => ({ nodeId: node.id, position, body: JSON.stringify(node) })),
      [],
    );

    const host = new ChatHost();
    const snapshot = await host.start({ id, agent: 'acp', projectPath: cwd, cwd, taskId: null });
    const status = (nodeId: string) => (snapshot.nodes.find((n) => n.id === nodeId) as { status: string }).status;
    expect(status('background')).toBe('completed');
    expect(status('waiting')).toBe('interrupted');
    expect(status('foreground')).toBe('interrupted');
    expect(status('read')).toBe('completed');
    expect(snapshot.seq).toBeGreaterThan(7);
    await host.stop(id);
  });
});
