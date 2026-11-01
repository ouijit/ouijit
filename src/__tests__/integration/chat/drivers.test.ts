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
import { _resetCacheForTesting } from '../../../db';
import type { ChatAgentId, ChatNode, ChatSnapshot, RequestNode, ToolCallNode } from '../../../chat/model';
import { loadCassette, recording, recordingSpawn, replayingSpawn, cassettePath } from './cassette';

const PROMPT =
  'Create a file named hello.txt containing the single word hi, using your file editing tool. Then reply with exactly: done';

let fakeBin: string;
const originalPath = process.env.PATH;

beforeAll(() => {
  _resetCacheForTesting();
  if (recording) return;
  fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-agents-'));
  for (const agent of ['claude', 'codex', 'pi'] as const) {
    if (!fs.existsSync(cassettePath(agent))) continue;
    const { version } = loadCassette(agent);
    fs.writeFileSync(path.join(fakeBin, agent), `#!/bin/sh\necho "${version ?? '99.0.0'}"\n`, { mode: 0o755 });
  }
  process.env.PATH = `${fakeBin}:${originalPath}`;
});

afterAll(() => {
  process.env.PATH = originalPath;
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
        `timed out; status ${snapshot.info.status} ${snapshot.info.statusDetail ?? ''}\n${JSON.stringify(snapshot.nodes.map((n) => n.kind))}`,
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
  const spawn = replayingSpawn(loadCassette(agent));
  return { host: new ChatHost({ spawnProcess: spawn }), spawn };
}

function kinds(nodes: ChatNode[]): string[] {
  return nodes.map((node) => node.kind);
}

describe.each(['claude', 'codex', 'pi'] as const)('%s in chat', (agent) => {
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
      stop();
    },
    timeout * 2,
  );
});
