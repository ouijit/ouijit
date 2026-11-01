/**
 * A second client — the phone this API is for — following a chat over HTTP
 * and answering the approval the agent blocks on, against Claude's recorded
 * stdio behind the app's own host and API server.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BrowserWindow } from 'electron';
import { startHookServer, stopHookServer, getApiPort } from '../../../hookServer';
import { issueToken } from '../../../apiAuth';
import { chatHost } from '../../../chat/host';
import { _resetCacheForTesting } from '../../../db';
import type { SequencedChatEvent } from '../../../chat/model';
import { loadCassettes, replayingSpawn } from './cassette';

const window = { isDestroyed: () => false, webContents: { send: () => undefined } } as unknown as BrowserWindow;
const originalPath = process.env.PATH;

beforeAll(async () => {
  _resetCacheForTesting();
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-agents-'));
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\necho "2.1.316"\n', { mode: 0o755 });
  process.env.PATH = `${bin}:${originalPath}`;
  process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-claude-'));
  await startHookServer(window);
});

afterAll(async () => {
  process.env.PATH = originalPath;
  delete process.env.CLAUDE_CONFIG_DIR;
  await stopHookServer();
});

async function call<T>(
  token: string,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const response = await fetch(`http://127.0.0.1:${getApiPort()}${url}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const payload = (await response.json()) as { data?: T };
  return { status: response.status, json: payload.data as T };
}

describe('a chat followed from another client', () => {
  test('reads it, waits for its events, answers its approval, and is refused when the chat tries to answer itself', async () => {
    chatHost._setOptionsForTesting({ spawnProcess: replayingSpawn(loadCassettes('claude')) });
    const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-remote-')));
    const id = 'pty-remote';
    await chatHost.start({ id, agent: 'claude', projectPath: cwd, cwd, taskId: null });
    const phone = issueToken('pty-phone', 'host');

    const before = await call<{ seq: number; info: { status: string } }>(phone, 'GET', `/api/chats/${id}`);
    expect(before.status).toBe(200);
    expect(before.json.info.status).toBe('idle');

    const sent = await call<{ id: string }>(phone, 'POST', `/api/chats/${id}/messages`, {
      text: 'Create a file named hello.txt containing the single word hi, using your file editing tool. Then reply with exactly: done',
    });
    expect(sent.status).toBe(200);

    // Follow along by long poll until the agent blocks on a request.
    let seq = before.json.seq;
    let requestId: string | null = null;
    for (let polls = 0; polls < 50 && !requestId; polls++) {
      const page = await call<{ events: SequencedChatEvent[] }>(phone, 'GET', `/api/chats/${id}?after=${seq}&wait=5`);
      for (const { seq: next, event } of page.json.events) {
        seq = next;
        if (event.type === 'node' && event.node.kind === 'request' && event.node.status === 'pending') {
          requestId = event.node.id;
        }
      }
    }
    expect(requestId).toBeTruthy();

    const pending = await call<{ pending: { id: string; options: { id: string }[] }[] }>(
      phone,
      'GET',
      `/api/chats/${id}`,
    );
    expect(pending.json.pending.map((p) => p.id)).toEqual([requestId]);

    const self = issueToken(id, 'host');
    const refused = await call(self, 'POST', `/api/chats/${id}/requests/${requestId}`, { option: 'allow' });
    expect(refused.status).toBe(403);

    const answered = await call(phone, 'POST', `/api/chats/${id}/requests/${requestId}`, { option: 'allow' });
    expect(answered.status).toBe(200);
    const again = await call(phone, 'POST', `/api/chats/${id}/requests/${requestId}`, { option: 'allow' });
    expect(again.status).toBe(409);

    for (let polls = 0; polls < 50; polls++) {
      const read = await call<{ info: { status: string }; text: string }>(phone, 'GET', `/api/chats/${id}`);
      if (read.json.info.status === 'idle' && /done/i.test(read.json.text)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const after = await call<{ text: string; pending: unknown[] }>(phone, 'GET', `/api/chats/${id}`);
    expect(after.json.text).toMatch(/done/i);
    expect(after.json.pending).toEqual([]);
    await chatHost.stop(id);
  });
});
