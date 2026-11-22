import { test, expect, beforeAll } from 'vitest';
import { homeChatState } from '../../../chat/homeChat';
import { _resetCacheForTesting, getChatRepo } from '../../../db';
import { HOME_CHAT_ID_PREFIX } from '../../../chat/preferences';

beforeAll(() => {
  _resetCacheForTesting();
});

/** A conversation as stored: started at `started`, with a message sent to it at each of `turns`. */
function stored(name: string, started: number, turns: number[], wake = false): string {
  const id = `${HOME_CHAT_ID_PREFIX}${name}`;
  const at = new Date(started).toISOString();
  getChatRepo().save(
    {
      id,
      project_path: '/chat',
      task_id: null,
      cwd: '/chat',
      worktree_path: null,
      agent: 'claude',
      agent_session_id: null,
      sandbox: null,
      role: 'home',
      info: JSON.stringify({ label: name }),
      seq: 0,
      created_at: at,
      updated_at: at,
    },
    turns.map((createdAt, position) => ({
      nodeId: `${name}-${position}`,
      position,
      body: JSON.stringify({
        id: `${name}-${position}`,
        kind: 'user_message',
        parentId: null,
        createdAt,
        text: 'go',
        attachments: [],
        delivery: 'prompt',
        ...(wake && position === turns.length - 1 && { wake: true }),
      }),
    })),
    [],
  );
  return name;
}

test("Chat's conversations list most recently active first, so one still going does not sink as new ones start", async () => {
  stored('long-running', 1_000, [1_000, 50_000], true);
  stored('newest, quiet', 40_000, [40_000]);
  stored('middle', 20_000, [20_000, 30_000]);
  stored('never used', 10_000, []);

  const { chats } = await homeChatState();
  // A wake counts as activity; one never sent a message ranks by when it started.
  expect(chats.map((chat) => chat.title)).toEqual(['long-running', 'newest, quiet', 'middle', 'never used']);
});
