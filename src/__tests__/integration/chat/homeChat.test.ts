/**
 * The app-wide chat through the real host and a cassette of an agent's stdio,
 * per agent: one process for Chat, one for a worker it hears about, one for
 * Chat restarted. Re-record with `RECORD_CASSETTES=1` and the agents signed in.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { chatHost } from '../../../chat/host';
import {
  _resetHomeChatForTesting,
  deleteHomeChat,
  homeChatDir,
  homeChatState,
  installHomeChat,
  isHomeChat,
  newHomeChat,
  restartHomeChat,
  startHomeChat,
  switchHomeChat,
} from '../../../chat/homeChat';
import { installHomeChatWakes } from '../../../chat/wake';
import { HOME_CHAT_SETTING_KEYS, UNTITLED_HOME_CHAT } from '../../../chat/preferences';
import { pendingRequests, type ChatAgentId, type ChatSnapshot, type UserMessageNode } from '../../../chat/model';
import { CLI_REFERENCE, getCliReferencePath } from '../../../hookServer';
import { getDriver } from '../../../chat/drivers';
import { _resetCacheForTesting, getChatRepo, setGlobalSetting } from '../../../db';
import { loadCassette, loadCassettes, recording, recordingSpawn, replayingSpawn, cassettePath } from './cassette';

const AGENTS = ['claude', 'codex', 'pi', 'opencode'] as const;
const cassetteName = (agent: ChatAgentId) => `home-chat-${agent}`;
const timeout = recording ? 240_000 : 20_000;
const originalPath = process.env.PATH;

beforeAll(() => {
  _resetCacheForTesting();
  fs.mkdirSync(path.dirname(getCliReferencePath()), { recursive: true });
  fs.writeFileSync(getCliReferencePath(), CLI_REFERENCE);
  if (recording) return;
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-agents-'));
  for (const agent of AGENTS) {
    if (!fs.existsSync(cassettePath(cassetteName(agent)))) continue;
    const { version } = loadCassette(cassetteName(agent));
    fs.writeFileSync(path.join(fakeBin, agent), `#!/bin/sh\necho "${version ?? '99.0.0'}"\n`, { mode: 0o755 });
  }
  process.env.PATH = `${fakeBin}:${originalPath}`;
  process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-claude-'));
});

afterAll(async () => {
  await chatHost.stopAll();
  process.env.PATH = originalPath;
  delete process.env.CLAUDE_CONFIG_DIR;
});

async function until(id: string, done: (snapshot: ChatSnapshot) => boolean): Promise<ChatSnapshot> {
  const started = Date.now();
  for (;;) {
    const snapshot = chatHost.snapshot(id)!;
    if (done(snapshot)) return snapshot;
    if (Date.now() - started > timeout) {
      throw new Error(
        `timed out on ${id}; status ${snapshot.info.status} ${snapshot.info.statusDetail ?? ''}\n${JSON.stringify(
          snapshot.nodes.map((n) => ('text' in n ? `${n.kind}: ${n.text.slice(0, 80)}` : n.kind)),
        )}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The agent of a conversation left behind goes in the background; this waits for it. */
async function awaitStopped(id: string): Promise<void> {
  const started = Date.now();
  while (chatHost.isLive(id)) {
    if (Date.now() - started > timeout) throw new Error(`${id} is still live`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function wakes(snapshot: ChatSnapshot): UserMessageNode[] {
  return snapshot.nodes.filter((n): n is UserMessageNode => n.kind === 'user_message' && n.wake === true);
}

function replies(snapshot: ChatSnapshot, word?: RegExp): number {
  return snapshot.nodes.filter((n) => n.kind === 'assistant_message' && (!word || word.test(n.text))).length;
}

/** Chat has taken a message in once it has answered it and gone quiet. */
const heard = (count: number) => (s: ChatSnapshot) =>
  s.info.status === 'idle' && wakes(s).length >= count && replies(s) >= count;

let installed = false;

describe.each(AGENTS)('the app-wide chat on %s', (agent) => {
  const name = cassetteName(agent);
  test.skipIf(!recording && !fs.existsSync(cassettePath(name)))(
    'runs under its settings, hears about a worker, and restarts on the same conversation',
    async () => {
      const probe = recording ? await getDriver(agent).probe() : null;
      chatHost._setOptionsForTesting({
        spawnProcess: recording ? recordingSpawn(name, agent, probe?.version) : replayingSpawn(loadCassettes(name)),
      });
      if (!installed) {
        installHomeChatWakes();
        installHomeChat();
      }
      installed = true;
      // One agent's leftovers must not become the next one's conversations.
      await chatHost.stopAll();
      for (const row of getChatRepo().listHome()) getChatRepo().delete(row.id);
      _resetHomeChatForTesting();
      await setGlobalSetting(HOME_CHAT_SETTING_KEYS.agent, agent);
      await setGlobalSetting(HOME_CHAT_SETTING_KEYS.sandbox, 'none');
      await setGlobalSetting(HOME_CHAT_SETTING_KEYS.instructions, 'Reply to every message with only the word: noted');
      await setGlobalSetting(
        HOME_CHAT_SETTING_KEYS.wake,
        JSON.stringify({ turnEnded: true, asked: true, taskMoved: true, hookFailed: true }),
      );

      const home = await startHomeChat();
      const HOME_CHAT_ID = home.info.id;
      expect(home.info.role).toBe('home');
      expect(home.info.label).toBe(UNTITLED_HOME_CHAT);
      expect(home.info.agent).toBe(agent);
      expect(home.info.status, home.info.statusDetail).toBe('idle');
      expect(home.info.projectPath).toBe(homeChatDir());
      expect(home.info.taskId).toBeNull();
      expect(fs.existsSync(path.join(homeChatDir(), '.git'))).toBe(true);

      // A worker that stops on an approval: Chat hears who, which chat, and
      // which request. One that runs its tools without asking, as Pi does, is
      // heard from when its turn ends.
      const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-worker-')));
      execFileSync('git', ['init', '-q'], { cwd });
      const worker = `pty-worker-${agent}`;
      await chatHost.start({ id: worker, agent, projectPath: cwd, cwd, taskId: null, label: 'Worker' });
      await chatHost.prompt(worker, {
        text: 'Create a file named note.txt containing the word hi, using your file editing tool. Then reply with only: first',
      });
      const stopped = await until(worker, (s) => pendingRequests(s.nodes).length > 0 || s.info.status === 'idle');
      const [request] = pendingRequests(stopped.nodes);
      let count = 0;
      if (request) {
        const heardAsk = await until(HOME_CHAT_ID, heard(++count));
        expect(wakes(heardAsk).map((n) => n.text)).toEqual([
          `Ouijit: Worker, chat ${worker}, is waiting on an approval: ${request.title} (request ${request.id}).`,
        ]);
        const allow = request.options.find((option) => option.kind === 'allow_once') ?? request.options[0];
        chatHost.answer(worker, request.id, { kind: 'option', optionId: allow.id });
      }
      await until(worker, (s) => s.info.status === 'idle' && replies(s, /first/) >= 1);
      const heardTurn = await until(HOME_CHAT_ID, heard(++count));
      expect(
        wakes(heardTurn)
          .map((n) => n.text)
          .at(-1),
      ).toBe(`Ouijit: Worker, chat ${worker}, finished its turn.`);

      // A kind of wake switched off is not delivered.
      await setGlobalSetting(
        HOME_CHAT_SETTING_KEYS.wake,
        JSON.stringify({ turnEnded: false, asked: true, taskMoved: true, hookFailed: true }),
      );
      await chatHost.prompt(worker, { text: 'Reply with only: second' });
      await until(worker, (s) => s.info.status === 'idle' && replies(s, /second/) >= 1);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(wakes(chatHost.snapshot(HOME_CHAT_ID)!)).toHaveLength(count);

      // A settings change restarts the agent on the same conversation: the
      // transcript stays, and the agent picks its own session back up.
      await setGlobalSetting(HOME_CHAT_SETTING_KEYS.instructions, 'Reply to every message with only the word: noted');
      const restarted = await restartHomeChat();
      expect(restarted.info.status).toBe('starting');
      expect(restarted.nodes.map((n) => n.id)).toEqual(heardTurn.nodes.map((n) => n.id));
      const resumed = await until(HOME_CHAT_ID, (s) => s.info.status === 'idle');
      expect(resumed.info.agentSessionId).toBe(heardTurn.info.agentSessionId);
      await chatHost.prompt(HOME_CHAT_ID, { text: 'Still there?' });
      const after = await until(HOME_CHAT_ID, (s) => s.info.status === 'idle' && replies(s) >= count + 1);
      expect(after.nodes.filter((n) => n.kind === 'user_message' && !n.wake).map((n) => n.text)).toEqual([
        'Still there?',
      ]);
      // The first thing it was asked names the conversation.
      expect(after.info.label).toBe('Still there?');

      // A new conversation leaves the old one in the list, and switching back resumes it, transcript and all.
      const fresh = await newHomeChat();
      expect(fresh.info.id).not.toBe(HOME_CHAT_ID);
      await awaitStopped(HOME_CHAT_ID);
      await until(fresh.info.id, (s) => s.info.status === 'idle');
      const listed = await homeChatState();
      expect(listed.currentId).toBe(fresh.info.id);
      // Nothing asked yet, the new one is open but not listed.
      expect(listed.chats.map((c) => [c.id, c.title])).toEqual([[HOME_CHAT_ID, 'Still there?']]);
      const back = await switchHomeChat(HOME_CHAT_ID);
      expect(back.nodes.map((n) => n.id)).toEqual(after.nodes.map((n) => n.id));
      await awaitStopped(fresh.info.id);
      await until(HOME_CHAT_ID, (s) => s.info.status === 'idle');
      expect((await homeChatState()).currentId).toBe(HOME_CHAT_ID);

      // Deleting another conversation leaves this one be; deleting the last one open starts a new one.
      expect((await deleteHomeChat(fresh.info.id)).chats.map((c) => c.id)).toEqual([HOME_CHAT_ID]);
      expect(getChatRepo().get(fresh.info.id)).toBeUndefined();
      expect(chatHost.snapshot(fresh.info.id)).toBeNull();
      const afterDelete = await deleteHomeChat(HOME_CHAT_ID);
      expect(chatHost.snapshot(HOME_CHAT_ID)).toBeNull();
      expect(afterDelete.chats).toEqual([]);
      expect(isHomeChat(afterDelete.currentId) && afterDelete.currentId !== HOME_CHAT_ID).toBe(true);
      await until(afterDelete.currentId, (s) => s.info.status === 'idle');
      expect(chatHost.snapshot(afterDelete.currentId)!.nodes).toEqual([]);
      await chatHost.stopAll();
    },
    timeout * 3,
  );
});
